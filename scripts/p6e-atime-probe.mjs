// 仅使用本轮新建的空白测试卷；不读取任何历史故障卷或生产数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { docker, localEngine } from './v11-maintenance.mjs'

localEngine()
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-ro-runtime-manifest.json'))
const prefix = 'xiaowork-p6e-atime-' + Date.now().toString(36)
const output = 'docs/evidence/P6E-atime-diagnosis-r4.json'
assert.equal(fs.existsSync(output), false)
const report = {
  date: new Date().toISOString(),
  prefix,
  cases: [],
  commands: [],
  result: 'RUNNING',
}
function run(args) {
  const value = docker(args)
  report.commands.push({ args, exitCode: 0 })
  return value
}
const security = [
  '--network',
  'none',
  '--read-only',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges:true',
]
const stat = `const fs=require('fs');const out={};for(const p of ['/probe','/probe/file','/probe/child','/probe/child/file']){const s=fs.lstatSync(p,{bigint:true});out[p]=Object.fromEntries(['dev','ino','mode','uid','gid','nlink','size','atimeNs','mtimeNs','ctimeNs','birthtimeNs'].map(k=>[k,String(s[k])]));}console.log(JSON.stringify(out));`
try {
  for (const operation of ['noatime-directory', 'noatime-file-sha', 'stat-only']) {
    const name = prefix + '-' + operation
    const volume = name + '-volume'
    run(['volume', 'create', '--label', 'io.xiaowork.p6e-atime.test=true', volume])
    const observer = run([
      'run',
      '-d',
      '--name',
      name,
      ...security,
      '--user',
      '0:0',
      '--mount',
      `type=volume,src=${volume},dst=/probe,volume-nocopy`,
      '--entrypoint',
      'node',
      manifest.images.worker.id,
      '--eval',
      'setInterval(()=>{},1000)',
    ])
    run([
      'exec',
      observer,
      'node',
      '--eval',
      "const f=require('fs');f.writeFileSync('/probe/file','fixed bytes');f.mkdirSync('/probe/child');f.writeFileSync('/probe/child/file','child bytes');",
    ])
    const before = JSON.parse(run(['exec', observer, 'node', '--eval', stat]))
    const row = { operation, volume, before }
    report.cases.push(row)
    let candidate
    if (operation.endsWith('create') || operation === 'nocopy-start') {
      candidate = run([
        'create',
        ...security,
        '--mount',
        `type=volume,src=${volume},dst=/source/db,readonly${operation === 'default-create' ? '' : ',volume-nocopy'}`,
        manifest.images.maintenance.id,
        'compatible',
        '-schema',
        '3',
      ])
      row.afterCreate = JSON.parse(run(['exec', observer, 'node', '--eval', stat]))
      if (operation === 'nocopy-start') row.start = run(['start', '-a', candidate])
    } else {
      const codes = {
        'ro-readdir': "console.log(require('fs').readdirSync('/probe'))",
        'rw-readdir': "console.log(require('fs').readdirSync('/probe'))",
        'noatime-directory':
          "const f=require('fs');const fd=f.openSync('/probe',f.constants.O_RDONLY|f.constants.O_DIRECTORY|f.constants.O_NOATIME);f.closeSync(fd)",
        'noatime-file-sha':
          "const f=require('fs'),c=require('crypto');const fd=f.openSync('/probe/file',f.constants.O_RDONLY|f.constants.O_NOATIME);console.log(c.createHash('sha256').update(f.readFileSync(fd)).digest('hex'));f.closeSync(fd)",
        'stat-only': stat,
      }
      run([
        'run',
        '--rm',
        ...security,
        '--user',
        '0:0',
        '--mount',
        `type=volume,src=${volume},dst=/probe,volume-nocopy${operation === 'rw-readdir' ? '' : ',readonly'}`,
        '--entrypoint',
        'node',
        manifest.images.worker.id,
        '--eval',
        codes[operation],
      ])
    }
    row.after = JSON.parse(run(['exec', observer, 'node', '--eval', stat]))
    row.changes = Object.keys(before).flatMap((p) =>
      Object.keys(before[p])
        .filter((k) => before[p][k] !== row.after[p][k])
        .map((k) => ({ path: p, field: k, before: before[p][k], after: row.after[p][k] })),
    )
    row.mountinfo = run([
      'exec',
      observer,
      'node',
      '--eval',
      "console.log(require('fs').readFileSync('/proc/self/mountinfo','utf8').split('\\n').filter(x=>x.includes(' /probe ')).join('\\n'))",
    ])
    run(['stop', observer])
    row.retainedContainer = observer
  }
  report.result = 'DIAGNOSED'
} catch (error) {
  report.result = 'DIAGNOSTIC_FAILED'
  report.error = String(error.message)
  process.exitCode = 1
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      result: report.result,
      cases: report.cases.map((c) => ({ operation: c.operation, changes: c.changes })),
    }),
  )
}
