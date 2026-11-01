// 测试专属父进程。子控制器失败/被杀时，仅停止本轮声明的本站写入者。
// 持久保护在子控制器执行任何源卷操作前已建立，父进程从不清除它。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { docker, localEngine, backupProject } from './v11-maintenance.mjs'
import { currentRepair } from './v11-current-repair.mjs'
import { runLifecycle } from './v11-release.mjs'
const projects = ['fault', 'repair', 'content', 'again'].map(
  (v) => 'xiaowork-homepage-v11-p6e-chain3-' + v,
)
const output = 'docs/evidence/P6E-chain3-supervisor.json'
assert.ok(!fs.existsSync(output), 'Preserve previous supervisor evidence')
localEngine()
for (const p of projects) {
  assert.ok(!fs.existsSync(path.resolve('.v11-deploy', p)), 'Use entirely new control state')
  assert.equal(docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + p]), '')
  assert.equal(
    docker(['volume', 'ls', '--format', '{{.Name}}'])
      .split(/\s+/)
      .some((n) => n.startsWith(p + '_')),
    false,
  )
}
const beforeOld = fs.readFileSync(
  '.v11-deploy/xiaowork-homepage-v11-p6e-atime2-fault/recovery-required.json',
)
const report = { date: new Date().toISOString(), projects, result: 'RUNNING', stages: [] }
const hash = (b) => createHash('sha256').update(b).digest('hex')
const log = fs.openSync('docs/evidence/P6E-chain3-chain-command.txt', 'wx')
const child = spawn(process.execPath, ['scripts/p6e-chain3-chain.mjs'], {
  stdio: ['ignore', log, log],
})
report.child = await new Promise((resolve, reject) => {
  child.on('error', reject)
  child.on('close', (code, signal) => resolve({ code, signal }))
})
fs.closeSync(log)
if (report.child.code !== 0) {
  report.result = 'STOPPED_WITH_PERSISTENT_PROTECTION'
  const runtime = JSON.parse(fs.readFileSync('docs/evidence/P6E-chain3-runtime-manifest.json'))
  for (const p of projects) {
    const ids = docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=' + p])
      .split(/\s+/)
      .filter(Boolean)
    const stopped = []
    for (const id of ids) {
      const c = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
      if (
        ['api', 'worker', 'api-init', 'publication-init'].includes(
          c.Config.Labels['com.docker.compose.service'],
        )
      ) {
        docker(['stop', '-t', '5', id])
        stopped.push(id)
      }
    }
    const dir = path.resolve('.v11-deploy', p),
      marker = path.join(dir, 'recovery-required.json')
    const blocked = {}
    for (const [name, fn] of Object.entries({
      backup: () =>
        backupProject(
          p,
          runtime.images.maintenance.id,
          path.resolve('.cache/v11-backups', p + '-should-refuse'),
        ),
      repair: () => currentRepair('inspect', p, runtime.images.maintenance.id),
      update: () => runLifecycle(['update', '--project', p, '--manifest', 'must-not-read']),
    })) {
      try {
        fn()
        blocked[name] = false
      } catch (e) {
        blocked[name] = { refused: true, error: e.message }
      }
    }
    report.stages.push({
      project: p,
      stopped,
      markerPresent: fs.existsSync(marker),
      markerSHA256: fs.existsSync(marker) ? hash(fs.readFileSync(marker)) : null,
      lockPresent: fs.existsSync(path.join(dir, 'operation.lock')),
      blocked,
    })
  }
  process.exitCode = 1
} else {
  report.result = 'PASS'
  for (const p of projects)
    assert.ok(!fs.existsSync(path.resolve('.v11-deploy', p, 'operation.lock')))
}
assert.equal(
  hash(
    fs.readFileSync('.v11-deploy/xiaowork-homepage-v11-p6e-atime2-fault/recovery-required.json'),
  ),
  hash(beforeOld),
)
report.oldManualContainmentUnchanged = true
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(report.result)
