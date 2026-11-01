// 本机专属验收控制器：不进入运行镜像，失败现场和锁永久留场。
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { protectedChain, operationState } from './v11-operation.mjs'
import { backupProject, docker, localEngine } from './v11-maintenance.mjs'
import { currentRepair } from './v11-current-repair.mjs'
import { runLifecycle } from './v11-release.mjs'

const runtime = JSON.parse(fs.readFileSync('docs/evidence/P6E-chain3-runtime-manifest.json'))
const images = Object.fromEntries(Object.entries(runtime.images).map(([k, v]) => [k, v.id]))
const hash = (b) => createHash('sha256').update(b).digest('hex')
const childMode = process.argv[2] === '--child'
const prefix = 'xiaowork-homepage-v11-p6e-c3-'
localEngine()

if (childMode) {
  const [project, mode] = process.argv.slice(3)
  assert.ok(project.startsWith(prefix))
  await protectedChain([project], 'full-chain-failure-test', async () => {
    const actualWorker = images.worker
    const api = docker([
      'run',
      '-d',
      '--name',
      project + '-worker',
      '--label',
      'com.docker.compose.project=' + project,
      '--label',
      'com.docker.compose.service=worker',
      '--network',
      'none',
      '--read-only',
      '--user',
      '10001:10001',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--entrypoint',
      'node',
      actualWorker,
      '-e',
      'setInterval(()=>{},1000)',
    ])
    fs.writeFileSync(
      path.join(operationState(project), 'current.json'),
      JSON.stringify({ project, spec: { format: 1, source: runtime.source, schema: 3, images } }),
      { flag: 'wx' },
    )
    if (mode === 'controller-exit') {
      console.log('CONTROLLER_READY_FOR_KILL')
      await new Promise(() => {
        setInterval(() => {}, 1000)
      })
    }
    if (mode === 'container-exit') {
      docker(['kill', '--signal', 'KILL', api])
      assert.equal(
        docker(['inspect', '--format', '{{.State.Running}}', api]),
        'true',
        'Required API container stopped unexpectedly',
      )
    }
    if (mode === 'identity') {
      docker([
        'create',
        '--name',
        project + '-fault-api',
        '--label',
        'com.docker.compose.project=' + project,
        '--label',
        'com.docker.compose.service=api',
        '--network',
        'none',
        'xiaowork-homepage-api:p6e-chain3-fault',
      ])
      docker([
        'create',
        '--name',
        project + '-init',
        '--label',
        'com.docker.compose.project=' + project,
        '--label',
        'com.docker.compose.service=api-init',
        '--network',
        'none',
        images.api,
      ])
      backupProject(project, images.maintenance, path.resolve('.cache/v11-backups', project))
      assert.fail('The identity mismatch must never reach acceptance')
    }
  })
} else {
  const output = 'docs/evidence/P6E-chain3-protection-r2.json'
  assert.ok(!fs.existsSync(output))
  const report = {
    date: new Date().toISOString(),
    source: runtime.source,
    cases: [],
    result: 'RUNNING',
  }
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  try {
    for (const mode of ['controller-exit', 'container-exit', 'identity']) {
      const project = prefix + mode + '-' + Date.now().toString(36)
      const outcome = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [process.argv[1], '--child', project, mode], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = '',
          stderr = ''
        child.stdout.on('data', (b) => {
          stdout += b
          if (mode === 'controller-exit' && stdout.includes('CONTROLLER_READY_FOR_KILL'))
            child.kill('SIGKILL')
        })
        child.stderr.on('data', (b) => {
          stderr += b
        })
        child.on('error', reject)
        child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
      })
      assert.ok(outcome.code !== 0)
      if (mode === 'controller-exit') {
        assert.ok(outcome.stdout.includes('CONTROLLER_READY_FOR_KILL'))
        assert.ok(outcome.signal === 'SIGKILL' || outcome.code === 1)
      }
      const marker = path.join(operationState(project), 'recovery-required.json')
      const before = hash(fs.readFileSync(marker))
      const ids = docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=' + project])
        .split(/\s+/)
        .filter(Boolean)
      if (ids.length) docker(['stop', '-t', '5', ...ids])
      assert.equal(
        docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=' + project]),
        '',
      )
      const refusals = {}
      for (const [name, action] of Object.entries({
        backup: () =>
          backupProject(
            project,
            images.maintenance,
            path.resolve('.cache/v11-backups', project + '-blocked'),
          ),
        repair: () => currentRepair('inspect', project, images.maintenance),
        update: () =>
          runLifecycle(['update', '--project', project, '--manifest', 'must-not-be-read.json']),
      })) {
        let error
        try {
          action()
        } catch (e) {
          error = e
        }
        assert.ok(error, name + ' was not blocked')
        refusals[name] = { refused: true, error: error.message }
      }
      const newProcess = spawnSync(
        process.execPath,
        [
          'scripts/v11-maintenance.mjs',
          'backup',
          project,
          images.maintenance,
          path.resolve('.cache/v11-backups', project + '-new-process'),
        ],
        { encoding: 'utf8' },
      )
      assert.equal(newProcess.status, 1)
      assert.match(newProcess.stderr, /blocks new tasks/)
      assert.equal(hash(fs.readFileSync(marker)), before)
      assert.ok(fs.statSync(path.join(operationState(project), 'operation.lock')).isDirectory())
      if (mode === 'identity') assert.match(outcome.stderr, /Actual project image differs/)
      if (mode === 'container-exit') assert.match(outcome.stderr, /stopped unexpectedly/)
      report.cases.push({
        mode,
        project,
        result: 'PASS',
        outcome,
        recoveryMarkerSHA256: before,
        markerUnchanged: true,
        lockRetained: true,
        writersStopped: true,
        publishing: 'REFUSED_API_NOT_RUNNING',
        refusals,
        newProcessExit: newProcess.status,
        manualRecoveryRequired: true,
      })
      console.log('PASS ' + mode)
      save()
    }
    report.result = 'PASS'
  } catch (error) {
    report.result = 'FAIL'
    report.error = error.message
    process.exitCode = 1
  } finally {
    save()
  }
}
