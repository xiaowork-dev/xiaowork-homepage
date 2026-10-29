// Isolated test controller only. Never mutates the retained failed source volumes.
// Run after freezing/building a new complete runtime manifest.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { currentRepair } from './v11-current-repair.mjs'
import { docker, localEngine, volumeNames } from './v11-maintenance.mjs'

localEngine()
const manifestPath = process.argv[2] ?? 'docs/evidence/P6E-ro-runtime-manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
assert.match(manifest.source, /^[a-f0-9]{40}$/)
const sourceProject = 'xiaowork-homepage-v11-p6e-closure-fault'
const prefix =
  'xiaowork-homepage-v11-p6e-ro-' + manifest.source.slice(0, 7) + '-' + Date.now().toString(36)
const cache = path.resolve('.cache', path.basename(prefix))
fs.mkdirSync(cache, { recursive: false, mode: 0o700 })
if (process.platform === 'win32')
  execFileSync(
    'icacls',
    [cache, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(OI)(CI)F`],
    { stdio: 'ignore' },
  )
// The first attempt failed BEFORE maintenance, in root-only fixture copying.
// Its evidence and partial volumes remain intact; this is a new attempt.
const output = 'docs/evidence/P6E-ro-readonly-matrix-r2.json'
assert.equal(
  fs.existsSync(output),
  false,
  'Preserve prior results; use an explicit new evidence file for a rerun',
)
const report = {
  date: new Date().toISOString(),
  source: manifest.source,
  maintenance: manifest.images.maintenance.id,
  fixtureOnly: true,
  sourceProject,
  prefix,
  cases: [],
  result: 'RUNNING',
}
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const mounts = (project, root, readonly = true) =>
  Object.entries(volumeNames(project)).flatMap(([role, name]) => [
    '--mount',
    `type=volume,src=${name},dst=${root}/${role}${readonly ? ',readonly' : ''}`,
  ])
const baseArgs = [
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
const inventoryCode = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const out=[];function walk(dir){const stat=fs.lstatSync(dir,{bigint:true}),name=dir.slice('/source/'.length);const item={path:name,mode:Number(stat.mode),uid:Number(stat.uid),gid:Number(stat.gid),dev:String(stat.dev),ino:String(stat.ino),nlink:String(stat.nlink),bytes:String(stat.size),mtimeNs:String(stat.mtimeNs),ctimeNs:String(stat.ctimeNs),atimeNs:String(stat.atimeNs)};if(stat.isSymbolicLink())item.link=fs.readlinkSync(dir);else if(stat.isFile())item.sha256=crypto.createHash('sha256').update(fs.readFileSync(dir)).digest('hex');else if(!stat.isDirectory())throw Error('special file refused');out.push(item);if(stat.isDirectory())for(const child of fs.readdirSync(dir).sort())walk(path.join(dir,child));}for(const child of fs.readdirSync('/source').sort())walk(path.join('/source',child));console.log(JSON.stringify(out));`
function inventory(project) {
  return JSON.parse(
    docker([
      ...baseArgs,
      '--user',
      '0:0',
      '--cap-add',
      'DAC_OVERRIDE',
      ...mounts(project, '/source'),
      '--entrypoint',
      'node',
      manifest.images.worker.id,
      '--eval',
      inventoryCode,
    ]),
  )
}
function stopped(project) {
  for (const id of docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
    .split(/\s+/)
    .filter(Boolean)) {
    const c = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
    if (
      ['api', 'worker', 'api-init', 'publication-init'].includes(
        c.Config.Labels['com.docker.compose.service'],
      )
    )
      assert.equal(c.State.Running, false)
  }
}
function copyFresh(project) {
  const names = volumeNames(project)
  const existing = new Set(docker(['volume', 'ls', '--format', '{{.Name}}']).split(/\s+/))
  assert.ok(
    Object.values(names).every((name) => !existing.has(name)),
    'Never reuse or overwrite a fixture volume',
  )
  for (const name of Object.values(names))
    docker([
      'volume',
      'create',
      '--label',
      `com.docker.compose.project=${project}`,
      '--label',
      'io.xiaowork.p6e-ro.test=true',
      name,
    ])
  const script = `const fs=require('node:fs'),path=require('node:path');function fix(p){const s=fs.lstatSync(p);if(!s.isSymbolicLink()){fs.chownSync(p,10001,10001);if(s.isDirectory())for(const n of fs.readdirSync(p))fix(path.join(p,n));}}for(const name of fs.readdirSync('/source')){for(const child of fs.readdirSync('/source/'+name))fs.cpSync('/source/'+name+'/'+child,'/target/'+name+'/'+child,{recursive:true,preserveTimestamps:true,verbatimSymlinks:true,errorOnExist:true,force:false});fix('/target/'+name);}`
  docker([
    ...baseArgs,
    '--user',
    '0:0',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--cap-add',
    'FOWNER',
    ...mounts(sourceProject, '/source'),
    ...mounts(project, '/target', false),
    '--entrypoint',
    'node',
    manifest.images.worker.id,
    '--eval',
    script,
  ])
}
function mutate(project, code) {
  docker([
    ...baseArgs,
    '--user',
    '0:0',
    '--cap-add',
    'DAC_OVERRIDE',
    '--cap-add',
    'FOWNER',
    '--cap-add',
    'CHOWN',
    '--mount',
    `type=volume,src=${volumeNames(project).db},dst=/db`,
    '--entrypoint',
    'node',
    manifest.images.worker.id,
    '--eval',
    code +
      ";for(const name of require('node:fs').readdirSync('/db'))require('node:fs').lchownSync('/db/'+name,10001,10001)",
  ])
}
const fixtureGo = `package main
import("database/sql";"encoding/json";"fmt";"os";_ "modernc.org/sqlite")
func main(){if len(os.Args)!=2{panic("one fixture action required")};db,e:=sql.Open("sqlite","file:/db/content.sqlite?mode=rw&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=wal_autocheckpoint(0)");if e!=nil{panic(e)};db.SetMaxOpenConns(1);exec:=func(q string){if _,e:=db.Exec(q);e!=nil{panic(e)}};var before int;if e:=db.QueryRow("SELECT revision FROM workspace WHERE id=1").Scan(&before);e!=nil{panic(e)};switch os.Args[1]{case "valid-wal":exec("UPDATE workspace SET revision=revision+7 WHERE id=1");case "uncommitted":exec("PRAGMA cache_size=1");exec("BEGIN IMMEDIATE");exec("UPDATE workspace SET revision=revision+99 WHERE id=1");exec("CREATE TABLE p6e_test_uncommitted(data BLOB)");for i:=0;i<20;i++{exec("INSERT INTO p6e_test_uncommitted VALUES(zeroblob(65536))")};case "schema":exec("INSERT INTO schema_migrations(version,applied_at,checksum) VALUES(4,'isolated-test','not-reviewed')");if e:=db.Close();e!=nil{panic(e)};case "drift":exec("UPDATE schema_migrations SET checksum='not-reviewed' WHERE version=1");if e:=db.Close();e!=nil{panic(e)};default:panic("unsupported fixture")};info:=map[string]any{"action":os.Args[1],"baseRevision":before};if s,e:=os.Stat("/db/content.sqlite-wal");e==nil{info["walBytes"]=s.Size()};json.NewEncoder(os.Stdout).Encode(info);fmt.Fprint(os.Stderr,"");os.Exit(0)}
`
function buildFixture() {
  const root = path.join(cache, 'fixture')
  fs.mkdirSync(root)
  for (const name of ['go.mod', 'go.sum'])
    fs.copyFileSync(path.join(manifest.sourceExport, 'backend', name), path.join(root, name))
  fs.writeFileSync(path.join(root, 'main.go'), fixtureGo)
  const base = manifest.baseImages.find((entry) => entry.tag.startsWith('golang:'))
  assert.equal(docker(['image', 'inspect', '--format', '{{.Id}}', base.tag]), base.identity.id)
  fs.writeFileSync(
    path.join(root, 'Dockerfile'),
    `FROM ${base.tag} AS build\nWORKDIR /src\nCOPY go.mod go.sum ./\nRUN GOPROXY=https://goproxy.cn go mod download\nCOPY main.go ./\nRUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -trimpath -o /fixture main.go\nFROM scratch\nCOPY --from=build /fixture /fixture\nUSER 10001:10001\nENTRYPOINT ["/fixture"]\n`,
  )
  const tag = 'xiaowork-homepage-readonly-fixture:p6e-ro-' + manifest.source.slice(0, 12)
  const built = spawnSync('docker', ['build', '-t', tag, root], {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 8 << 20,
  })
  fs.writeFileSync(
    path.join(cache, 'fixture-build.txt'),
    (built.stdout ?? '') + (built.stderr ?? ''),
  )
  assert.equal(built.status, 0, 'Test fixture failed to build; no source data was modified')
  report.fixtureImage = docker(['image', 'inspect', '--format', '{{.Id}}', tag])
  return tag
}
function fixture(project, image, action) {
  return JSON.parse(
    docker([
      ...baseArgs,
      '--mount',
      `type=volume,src=${volumeNames(project).db},dst=/db`,
      image,
      action,
    ]),
  )
}
try {
  save()
  stopped(sourceProject)
  assert.equal(
    docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${sourceProject}`]),
    '',
  )
  const original = inventory(sourceProject)
  report.originalBeforeSHA256 = sha(original)
  const image = buildFixture()
  let stableRevision
  const cases = [
    { id: 'stable', pass: true },
    { id: 'committed', pass: true, action: 'valid-wal', revisionDelta: 7 },
    {
      id: 'wal-no-shm',
      pass: true,
      action: 'valid-wal',
      revisionDelta: 7,
      mutation: "require('node:fs').unlinkSync('/db/content.sqlite-shm')",
    },
    {
      id: 'readonly-dir',
      pass: true,
      mutation:
        "const fs=require('node:fs');fs.chmodSync('/db/content.sqlite',0o444);fs.chmodSync('/db',0o555)",
    },
    { id: 'uncommitted', pass: false, action: 'uncommitted' },
    {
      id: 'truncated-wal',
      pass: false,
      action: 'valid-wal',
      mutation:
        "const fs=require('node:fs');const p='/db/content.sqlite-wal';fs.truncateSync(p,fs.statSync(p).size-1)",
    },
    {
      id: 'bad-wal',
      pass: false,
      action: 'valid-wal',
      mutation:
        "const fs=require('node:fs');const p='/db/content.sqlite-wal',b=fs.readFileSync(p);b[b.length-1]^=1;fs.writeFileSync(p,b)",
    },
    {
      id: 'unreadable',
      pass: false,
      mutation: "require('node:fs').chmodSync('/db/content.sqlite',0o000)",
    },
    {
      id: 'missing',
      pass: false,
      mutation: "require('node:fs').renameSync('/db/content.sqlite','/db/content.sqlite.retained')",
    },
    {
      id: 'corrupt',
      pass: false,
      mutation:
        "const fs=require('node:fs');const p='/db/content.sqlite',b=fs.readFileSync(p);b.fill(255,0,100);fs.writeFileSync(p,b)",
    },
    { id: 'schema', pass: false, action: 'schema' },
    { id: 'drift', pass: false, action: 'drift' },
    {
      id: 'orphan-shm',
      pass: false,
      mutation:
        "require('node:fs').writeFileSync('/db/content.sqlite-shm',Buffer.alloc(32768,0),{flag:'wx'})",
    },
    {
      id: 'journal',
      pass: false,
      mutation:
        "require('node:fs').writeFileSync('/db/content.sqlite-journal',Buffer.alloc(512,85),{flag:'wx'})",
    },
  ]
  for (const test of cases) {
    const project = prefix + '-' + test.id
    copyFresh(project)
    const fixtureResult = test.action ? fixture(project, image, test.action) : undefined
    if (fixtureResult && ['valid-wal', 'uncommitted'].includes(test.action))
      assert.ok(fixtureResult.walBytes > 32, 'Fixture error: missing real WAL frames')
    if (test.mutation) mutate(project, test.mutation)
    const before = inventory(project)
    fs.writeFileSync(
      path.join(cache, test.id + '-before.json'),
      JSON.stringify(before, null, 2) + '\n',
      { mode: 0o600 },
    )
    const row = {
      case: test.id,
      project,
      expected: test.pass ? 'PASS_READ_ONLY_INSPECTION' : 'REFUSE_AND_RETAIN_LOCK',
      fixtureResult,
      beforeSHA256: sha(before),
      mount: 'all-six-volumes-readonly',
      result: 'RUNNING',
    }
    report.cases.push(row)
    save()
    let plan, error
    try {
      plan = currentRepair('inspect', project, manifest.images.maintenance.id)
    } catch (e) {
      error = e
    }
    row.exitCode = error?.status ?? (error ? 1 : 0)
    if (test.pass) {
      assert.ifError(error)
      assert.equal(plan.candidates.length, 1)
      if (test.id === 'stable') stableRevision = plan.state.workspaceRevision
      assert.equal(plan.state.workspaceRevision, stableRevision + (test.revisionDelta ?? 0))
      const repeated = currentRepair('inspect', project, manifest.images.maintenance.id)
      assert.deepEqual(repeated, plan)
      row.state = plan.state
      row.planSHA256 = plan.sha256
      row.repeatedInspectionIdentical = true
      assert.equal(fs.existsSync(path.resolve('.v11-deploy', project, 'operation.lock')), false)
    } else {
      assert.ok(error, 'Unsafe state was not refused')
      row.stderr = String(error.stderr ?? error.message).slice(0, 4000)
      const category = {
        uncommitted: 'wal-state-unproven',
        'truncated-wal': 'wal-state-unproven',
        'bad-wal': 'wal-state-unproven',
        unreadable: 'permission',
        missing: 'absent',
        corrupt: 'corrupt',
        schema: 'unsupported',
        drift: 'checksum mismatch',
        'orphan-shm': 'wal-state-unproven',
        journal: 'journal-state-unproven',
      }[test.id]
      assert.ok(row.stderr.includes(category), 'Wrong failure classification: expected ' + category)
      row.expectedErrorCategory = category
      assert.equal(
        fs.existsSync(path.resolve('.v11-deploy', project, 'operation.lock')),
        true,
        'Unknown DB state must preserve the host guard',
      )
      row.operationLockRetained = true
      assert.throws(() => currentRepair('inspect', project, manifest.images.maintenance.id))
      row.repeatedAttemptBlocked = true
    }
    const after = inventory(project)
    fs.writeFileSync(
      path.join(cache, test.id + '-after.json'),
      JSON.stringify(after, null, 2) + '\n',
      { mode: 0o600 },
    )
    assert.deepEqual(after, before, 'Source main/WAL/SHM/all-file metadata or SHA changed')
    row.afterSHA256 = sha(after)
    row.allFileMetadataAndSHA256Unchanged = true
    row.databaseFiles = before.filter((f) => f.path.startsWith('db/'))
    row.result = 'PASS'
    console.log('PASS read-only matrix ' + test.id)
    save()
  }
  const originalAfter = inventory(sourceProject)
  assert.deepEqual(originalAfter, original)
  report.originalAfterSHA256 = sha(originalAfter)
  report.retainedOriginalUnchanged = true
  report.result = 'PASS'
  report.retention =
    'All dedicated fixture volumes and all failure operation locks retained; original historical source was only mounted readonly. No repair attempted by this matrix.'
} catch (error) {
  fs.writeFileSync(
    path.join(cache, 'failure-private.txt'),
    String(error.stack ?? error) + '\n' + String(error.stderr ?? ''),
    { mode: 0o600, flag: 'wx' },
  )
  report.result = 'FAIL'
  report.error =
    error.code === 'ERR_ASSERTION'
      ? error.message
      : 'Read-only matrix stopped; inspect private local command log'
  report.action =
    'Stop automated repair attempts; retain all fixture volumes, original scene and operation locks'
  process.exitCode = 1
  console.error(report.error)
} finally {
  save()
}
