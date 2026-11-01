// Isolated real-volume/process fault controller. Never loaded by runtime images.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { docker, localEngine, volumeNames, tool } from './v11-maintenance.mjs'
localEngine()
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime-runtime-manifest.json'))
const matrix = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime-readonly-matrix.json'))
assert.equal(matrix.result, 'PASS')
assert.equal(matrix.source, manifest.source)
const source = matrix.cases.find((c) => c.case === 'stable').project
const prefix = 'xiaowork-homepage-v11-p6e-g-' + Date.now().toString(36)
const cache = path.resolve('.cache', prefix)
fs.mkdirSync(cache, { recursive: false, mode: 0o700 })
const output = 'docs/evidence/P6E-atime-real-guards.json'
assert.equal(fs.existsSync(output), false, 'Preserve earlier evidence')
const report = {
  source: manifest.source,
  date: new Date().toISOString(),
  cases: [],
  result: 'RUNNING',
}
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
const hash = (b) => createHash('sha256').update(b).digest('hex')
const mount = (project, root, ro = true) =>
  Object.entries(volumeNames(project)).flatMap(([role, name]) => [
    '--mount',
    `type=volume,src=${name},dst=${root}/${role},volume-nocopy${ro ? ',readonly' : ''}`,
  ])
const sandbox = [
  'run',
  '--rm',
  '--network',
  'none',
  '--read-only',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges:true',
]
function fresh(project) {
  for (const name of Object.values(volumeNames(project))) {
    assert.equal(
      docker(['volume', 'ls', '--filter', 'name=^' + name + '$', '--format', '{{.Name}}']),
      '',
    )
    docker(['volume', 'create', '--label', 'io.xiaowork.atime-guard-test=true', name])
  }
  docker([
    ...sandbox,
    '--user',
    '0:0',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--cap-add',
    'FOWNER',
    ...mount(source, '/source'),
    ...mount(project, '/target', false),
    '--entrypoint',
    'node',
    manifest.images.worker.id,
    '--eval',
    `const fs=require('node:fs'),p=require('node:path');function fix(x){let s=fs.lstatSync(x);fs.lchownSync(x,10001,10001);if(s.isDirectory())for(const n of fs.readdirSync(x))fix(p.join(x,n))}for(const n of fs.readdirSync('/source')){for(const f of fs.readdirSync('/source/'+n))fs.cpSync('/source/'+n+'/'+f,'/target/'+n+'/'+f,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true,errorOnExist:true,force:false});fix('/target/'+n)}`,
  ])
}
function inventory(project) {
  return tool(manifest.images.maintenance.id, 'metadata-readonly', mount(project, '/source'))
}
function runChild(project, mode, acceptance = '') {
  const file = path.join(cache, mode + '.mjs')
  const helper = pathToFileURL(path.resolve('scripts/v11-current-repair.mjs')).href
  let hook = ''
  if (['mount', 'maintainer', 'delta'].includes(mode))
    hook = `
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const original=cp.execFileSync;const commands=new Map();let injected=false;
cp.execFileSync=function(file,args,options){
 if(file==='docker'&&args[0]==='create'){
  const command=args.find(v=>['metadata-readonly','inspect-current'].includes(v));
  let actual=[...args];
  if(command==='inspect-current'&&${JSON.stringify(mode)}==='maintainer')actual.splice(1,0,'--cpus','0.01');
  if(command==='metadata-readonly'&&${JSON.stringify(mode)}==='mount'&&!injected){injected=true;const i=actual.findIndex(v=>v.includes('dst=/source/db,'));actual[i]=actual[i].replace(',readonly','')}
  const id=original.call(this,file,actual,options).trim();commands.set(id,command);return id;
 }
 if(file==='docker'&&args[0]==='start'&&commands.get(args.at(-1))==='inspect-current'){
   const id=args.at(-1);
   if(${JSON.stringify(mode)}==='maintainer'){
     original.call(this,'docker',['start',id],options);
     original.call(this,'docker',['kill','--signal','KILL',id],options);
     return original.call(this,'docker',['logs',id],options);
   }
   const r=original.call(this,file,args,options);
   if(${JSON.stringify(mode)}==='delta')original.call(this,'docker',${JSON.stringify([...sandbox, ...['--mount', `type=volume,src=${volumeNames(project).uploads},dst=/uploads,volume-nocopy`], '--entrypoint', 'node', manifest.images.worker.id, '--eval', "require('node:fs').writeFileSync('/uploads/controlled-metadata-fixture','isolated test only',{flag:'wx'})"])},options);
   return r;
 }
 return original.call(this,file,args,options)
};syncBuiltinESMExports();`
  fs.writeFileSync(
    file,
    `import fs from 'node:fs';${hook}\nconst {currentRepair}=await import(${JSON.stringify(helper)});try{currentRepair('inspect',${JSON.stringify(project)},${JSON.stringify(manifest.images.maintenance.id)},undefined,undefined,undefined,${acceptance || 'undefined'});console.log('ACCEPTED')}catch(e){console.error(String(e.stderr??e.message));process.exitCode=1}`,
  )
  return file
}
function blocked(project) {
  const state = path.resolve('.v11-deploy', project)
  assert.ok(fs.existsSync(path.join(state, 'operation.lock')))
  assert.ok(fs.existsSync(path.join(state, 'recovery-required.json')))
  const code = `import {currentRepair} from './scripts/v11-current-repair.mjs';import {backupProject,inspectProject} from './scripts/v11-maintenance.mjs';let n=0;for(const f of [()=>currentRepair('inspect','${project}','${manifest.images.maintenance.id}'),()=>backupProject('${project}','${manifest.images.maintenance.id}','unused'),()=>inspectProject('${project}','${manifest.images.maintenance.id}')]){try{f()}catch(e){if(String(e.message).includes('Persistent '))n++}}if(n!==3)process.exit(92);console.log('BLOCKED_THREE_NEW_TASKS')`
  const next = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
  })
  assert.equal(next.status, 0, next.stderr)
  const update = spawnSync(
    process.execPath,
    ['scripts/v11-release.mjs', 'update', '--project', project, '--manifest', 'unused'],
    { encoding: 'utf8' },
  )
  assert.notEqual(update.status, 0)
  assert.match(update.stderr, /EEXIST|recovery-required|Recovery/)
  return {
    operationLockRetained: true,
    recoveryRequiredRetained: true,
    newProcessMaintenanceRepairBackupBlocked: true,
    lifecycleUpdateExit: update.status,
    lifecycleUpdateError: update.stderr.trim(),
  }
}
try {
  save()
  for (const mode of ['external-writer', 'mount', 'outer', 'wrapper', 'maintainer', 'delta']) {
    const project = prefix + '-' + mode
    fresh(project)
    const before = inventory(project),
      row = { case: mode, project, result: 'RUNNING', beforeSHA256: hash(JSON.stringify(before)) }
    report.cases.push(row)
    save()
    let writer
    if (mode === 'external-writer')
      writer = docker([
        'run',
        '-d',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--mount',
        `type=volume,src=${volumeNames(project).db},dst=/db,volume-nocopy`,
        '--entrypoint',
        'sleep',
        manifest.images.worker.id,
        '300',
      ])
    const ready = path.join(cache, mode + '.ready')
    const acceptance =
      mode === 'outer'
        ? `()=>{throw Error('TEST_ONLY_OUTER_ASSERTION')}`
        : mode === 'wrapper'
          ? `()=>{fs.writeFileSync(${JSON.stringify(ready)},'all real queries finished');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)}`
          : ''
    const script = runChild(project, mode, acceptance)
    if (mode === 'wrapper') {
      const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (b) => (stderr += b))
      const exited = new Promise((resolve) =>
        child.on('exit', (code, signal) => resolve({ code, signal })),
      )
      const deadline = Date.now() + 120000
      while (!fs.existsSync(ready) && Date.now() < deadline && child.exitCode === null)
        await new Promise((resolve) => setTimeout(resolve, 50))
      assert.ok(fs.existsSync(ready), 'Real query did not reach acceptance checkpoint: ' + stderr)
      child.kill('SIGKILL')
      row.childExit = await exited
      row.stderr = stderr
      assert.notEqual(row.childExit.code, 0)
    } else {
      const child = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 180000 })
      row.exitCode = child.status
      row.stderr = child.stderr.trim()
      assert.notEqual(child.status, 0, 'Expected real failure was not refused')
      const expected = {
        'external-writer': /writable access/,
        mount: /access differs/,
        outer: /TEST_ONLY_OUTER_ASSERTION/,
        maintainer: /Maintenance exited nonzero/,
        delta: /Source metadata or file SHA256 changed/,
      }[mode]
      assert.match(child.stderr, expected)
    }
    if (writer) docker(['stop', '-t', '1', writer])
    const after = inventory(project)
    fs.writeFileSync(
      path.join(cache, mode + '-before.json'),
      JSON.stringify(before, null, 2) + '\n',
    )
    fs.writeFileSync(path.join(cache, mode + '-after.json'), JSON.stringify(after, null, 2) + '\n')
    row.afterSHA256 = hash(JSON.stringify(after))
    if (mode === 'delta') {
      assert.notDeepEqual(after, before)
      assert.ok(after.some((f) => f.path === 'uploads/controlled-metadata-fixture'))
      row.deliberateTestOnlyMutation = true
    } else assert.deepEqual(after, before, 'Unexpected strict source metadata delta; STOP')
    Object.assign(row, blocked(project))
    if (['outer', 'wrapper'].includes(mode)) {
      const marker = path.resolve('.v11-deploy', project, 'recovery-required.json')
      const review = spawnSync(
        process.execPath,
        [
          'scripts/v11-current-repair.mjs',
          'review',
          project,
          manifest.images.maintenance.id,
          hash(fs.readFileSync(marker)),
          'Manual isolated review: owner exited, full source inventory and business state revalidated',
        ],
        { encoding: 'utf8', timeout: 180000 },
      )
      row.manualReviewExit = review.status
      row.manualReviewError = review.stderr.trim()
      assert.equal(review.status, 0, review.stderr)
      assert.equal(fs.existsSync(marker), false)
      const repeat = spawnSync(
        process.execPath,
        ['scripts/v11-current-repair.mjs', 'inspect', project, manifest.images.maintenance.id],
        { encoding: 'utf8', timeout: 180000 },
      )
      assert.equal(repeat.status, 0, repeat.stderr)
      assert.deepEqual(inventory(project), before)
      row.explicitReviewedRecoveryAndRepeatPassed = true
    } else if (mode === 'delta') {
      const marker = path.resolve('.v11-deploy', project, 'recovery-required.json')
      const review = spawnSync(
        process.execPath,
        [
          'scripts/v11-current-repair.mjs',
          'review',
          project,
          manifest.images.maintenance.id,
          hash(fs.readFileSync(marker)),
          'Test controlled changed metadata must not permit recovery acknowledgement',
        ],
        { encoding: 'utf8', timeout: 180000 },
      )
      assert.notEqual(review.status, 0)
      assert.match(review.stderr, /metadata or bytes changed/)
      Object.assign(row, blocked(project))
      row.changedSourceReviewRefused = true
    }
    row.result = 'PASS'
    save()
    console.log('PASS real guard ' + mode)
  }
  report.result = 'PASS'
  report.limitations = [
    'Fresh process recovery tested; host OS/Docker daemon reboot and physical power loss NOT_RUN. Windows directory fsync unavailable; no claim of tested power-loss durability.',
    'Intentional metadata mutation is confined to its new dedicated fault volume; no unexpected source delta is accepted.',
  ]
} catch (error) {
  report.result = 'FAIL'
  report.error = error.message
  process.exitCode = 1
  console.error(error.message)
} finally {
  save()
}
