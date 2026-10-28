// Real isolated Nuxt/API/SQLite/Worker/HTTP failure tests. Every injected
// checkpoint exists only in a p6e_fault-tagged executable/test source overlay.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  cli,
  compose,
  configureWorker,
  initializeTestAdministrator,
  origin,
  prepareEnvironment,
  project,
  startBrowserContainer,
  stopBrowserContainer,
  testApiImage,
} from './p6e-fault-environment.mjs'

const allowed = [
  'baseline',
  'compile-error',
  'timeout',
  'building-exit',
  'before-switch',
  'after-switch',
  'sqlite-commit-exit',
  'api-restart',
  'static-restart',
  'corrupt-history',
  'http-unavailable',
  'recovery-fails',
  'enospc',
]
const name = process.argv[2] ?? 'baseline'
assert.ok(allowed.includes(name))
const postfixApi = process.argv[3] === '--postfix-api'
assert.ok(process.argv.length <= 3 || (postfixApi && name === 'recovery-fails'))
const { chromium } = createRequire(path.resolve('admin/package.json'))('playwright-core')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const report = {
  date: new Date().toISOString(),
  project,
  case: name,
  scope: 'Dedicated local volumes only; test-tagged binaries; no production connection',
  tlsVerificationDisabled: false,
  events: [],
  result: 'RUNNING',
  variant: postfixApi ? 'success-diagnostic-cleanup-postfix-api' : 'frozen-baseline',
}
let browser, page, credentials
let stage = 'environment'
const out = path.resolve(`docs/evidence/P6E-faults-${name}${postfixApi ? '-postfix' : ''}.json`)
async function save() {
  await writeFile(out, JSON.stringify(report, null, 2) + '\n')
}
async function event(point, detail = {}) {
  report.events.push({ time: new Date().toISOString(), point, ...detail })
  console.log(point)
  await save()
}
async function read(route) {
  return page.evaluate(async (endpoint) => {
    const r = await fetch(endpoint, { cache: 'no-store' })
    if (!r.ok) throw new Error('Authenticated fault read rejected ' + r.status)
    return (await r.json()).data
  }, '/api/admin/v1' + route)
}
async function post(route, body, revision) {
  return page.evaluate(
    async ({ endpoint, body, revision, key }) => {
      const s = (await (await fetch('/api/admin/v1/auth/session', { cache: 'no-store' })).json())
        .data
      const r = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': s.csrfToken,
          ...(revision ? { 'If-Match': '"' + revision + '"' } : {}),
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      })
      const json = await r.json()
      return { status: r.status, data: json.data, error: json.error?.code }
    },
    {
      endpoint: '/api/admin/v1' + route,
      body,
      revision,
      key: 'p6e-' + randomBytes(16).toString('hex'),
    },
  )
}
async function reauth() {
  const r = await post('/auth/reauth', { password: credentials.password })
  assert.equal(r.status, 200)
}
function db(command = 'inspect') {
  const volume = project + '_admin-db'
  assert.equal(
    cli('volume', 'inspect', '--format', '{{index .Labels "com.docker.compose.project"}}', volume),
    project,
  )
  return cli(
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    '10001:10001',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--mount',
    `type=volume,src=${volume},dst=/data`,
    postfixApi
      ? testApiImage.replace('xiaowork-homepage-api:', 'xiaowork-homepage-fault-data:')
      : 'xiaowork-homepage-fault-data:p6e-test',
    command,
  )
}
function files(operation = 'state', id = '') {
  if (id) assert.match(id, /^rel_[a-f0-9]{32}$/)
  const code = `const fs=require('fs');const crypto=require('crypto');const digest=p=>{try{return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}catch{return null}};const root='/publications';const op=process.argv[1],id=process.argv[2];if(op==='state'){let current=null;try{current=fs.readlinkSync(root+'/current')}catch{};console.log(JSON.stringify({current,releases:fs.readdirSync(root+'/releases').sort().map(id=>({id,manifestSha256:digest(root+'/releases/'+id+'/manifest.json'),homepageSha256:digest(root+'/releases/'+id+'/public/index.html')})),staging:fs.readdirSync(root+'/staging').sort(),currentNextCount:fs.readdirSync(root).filter(n=>n.startsWith('current.next.')).length,activations:fs.readdirSync(root+'/activations').sort().map(id=>({id,intent:fs.existsSync(root+'/activations/'+id+'/intent.json'),receipt:fs.existsSync(root+'/activations/'+id+'/receipt.json'),recovery:fs.existsSync(root+'/activations/'+id+'/recovery.json')}))}))}else if(op==='root-readonly'){fs.chmodSync(root,0o500);try{fs.writeFileSync(root+'/p6e-write-probe','x',{flag:'wx'});process.exit(8)}catch(e){console.log(JSON.stringify({code:e.code,mode:'0500'}));if(e.code!=='EACCES')process.exit(9)}}else if(op==='root-writable'){fs.chmodSync(root,0o700);console.log('TEST_ROOT_WRITE_RESTORED')}else{if(!/^rel_[a-f0-9]{32}$/.test(id))process.exit(2);const p=root+'/releases/'+id+'/public/index.html',saved=root+'/releases/'+id+'/public/.p6e-held-index';if(op==='damage')fs.renameSync(p,saved);else if(op==='repair')fs.renameSync(saved,p);else process.exit(3);console.log('TEST_ONLY_'+op)}`
  const volume = project + '_admin-publications'
  assert.equal(
    cli('volume', 'inspect', '--format', '{{index .Labels "com.docker.compose.project"}}', volume),
    project,
  )
  return cli(
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    '10001:10001',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--mount',
    `type=volume,src=${volume},dst=/publications`,
    '--entrypoint',
    '/usr/local/bin/node',
    'xiaowork-homepage-worker:p6e-fault',
    '-e',
    code,
    '--',
    operation,
    id,
  )
}
async function publicProof() {
  const result = []
  for (const route of ['/', '/projects/', '/about/', '/__xiaowork-release.json']) {
    try {
      const r = await fetch('http://127.0.0.1:3213' + route, { cache: 'no-store' })
      result.push({
        route,
        status: r.status,
        sha256: createHash('sha256')
          .update(Buffer.from(await r.arrayBuffer()))
          .digest('hex'),
      })
    } catch {
      result.push({ route, status: 'unavailable' })
    }
  }
  return result
}
async function snapshot(point, jobId) {
  const status = await read('/publishing-status')
  const job = jobId ? (await read('/jobs/' + jobId)).job : null
  stage = 'snapshot-safe-sqlite-inspection'
  const sqlite = JSON.parse(db())
  stage = 'snapshot-safe-filesystem-inspection'
  const filesystem = JSON.parse(files())
  stage = 'snapshot-public-http'
  await event(point, {
    status,
    job,
    sqlite,
    filesystem,
    http: await publicProof(),
  })
  if (['second-rollback-write-also-failed', 'recovered-after-boundary'].includes(point)) {
    await page.goto(origin + '/admin/publishing')
    await page.getByRole('heading', { name: '发布、预览与历史', exact: true }).waitFor()
    await pause(1500)
    assert.equal(
      await page
        .locator('input[type="password"]')
        .evaluateAll((items) => items.some((i) => i.value)),
      false,
    )
    await page.screenshot({
      path: `docs/evidence/P6E-faults-${name}${postfixApi ? '-postfix' : ''}-${point}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
  return { status, job }
}
async function waitAvailable() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if ((await read('/publishing-status')).workerAvailable) return
    await pause(1000)
  }
  throw new Error('Worker did not become available')
}
async function waitTerminal(id, timeout = 190000) {
  const deadline = Date.now() + timeout
  let last = ''
  while (Date.now() < deadline) {
    const { job } = await read('/jobs/' + id)
    const state = JSON.stringify([job.status, job.phase, job.error])
    if (last !== state) {
      await event('task-state', { job })
      last = state
    }
    if (['succeeded', 'failed'].includes(job.status)) return job
    await pause(1000)
  }
  throw new Error('Task did not reach a verified terminal state')
}
async function waitTerminalWithWorkerRestart(id) {
  const until = Date.now() + 360000
  while (Date.now() < until) {
    const { job } = await read('/jobs/' + id)
    if (['succeeded', 'failed'].includes(job.status)) return job
    if (cli('inspect', '--format', '{{.State.Running}}', project + '-worker-1') === 'false') {
      await event('operator-restarted-fail-closed-worker-after-api-restart', { jobId: id })
      compose('start', 'worker')
    }
    await pause(1000)
  }
  throw new Error('API restart task remains unresolved')
}
async function submit(kind = 'publish', target) {
  // Test-controller coordination only; never consumed by an API/Worker.
  const hold = path.resolve('.cache/p6e-fault-performance-hold')
  if (existsSync(hold)) {
    await event('test-controller-paused-before-task-for-independent-performance-measurement')
    while (existsSync(hold)) await pause(1000)
  }
  await waitAvailable()
  await reauth()
  const w = await read('/workspace'),
    s = await read('/publishing-status')
  const body = { confirmAllChanges: true, reviewedActiveReleaseId: s.activeReleaseId ?? null }
  if (target) body.targetReleaseId = target
  const r = await post('/' + kind + '-jobs', body, w.revision)
  await event('submission', { httpStatus: r.status, error: r.error, jobId: r.data?.jobId })
  assert.equal(r.status, 202)
  return r.data.jobId
}
async function setWorker(mode = 'none', variant = 'normal') {
  compose('stop', '-t', '2', 'worker')
  await configureWorker(mode, variant)
  compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'worker')
  await waitAvailable()
}
async function waitCheckpoint(service, point) {
  const until = Date.now() + 240000
  while (Date.now() < until) {
    const logs = compose('logs', '--no-log-prefix', service)
    if (logs.includes('P6E_TEST_CHECKPOINT ' + point)) {
      await event('checkpoint-observed', { service, point })
      return
    }
    await pause(200)
  }
  throw new Error('Real checkpoint not observed')
}
function continueCheckpoint() {
  compose(
    'exec',
    '-T',
    'worker',
    '/usr/local/bin/node',
    '-e',
    "require('fs').writeFileSync('/tmp/p6e-continue','continue fixed test checkpoint')",
  )
}
async function waitBuild(job) {
  const until = Date.now() + 90000
  while (Date.now() < until) {
    const text = cli('top', project + '-worker-1', '-eo', 'pid,args')
    if (text.includes('/builder/node_modules/nuxt/bin/nuxt.mjs generate /work/' + job)) {
      await event('real-nuxt-process-observed', { jobId: job })
      return
    }
    const j = (await read('/jobs/' + job)).job
    assert.ok(!['succeeded', 'failed'].includes(j.status))
    await pause(100)
  }
  throw new Error('Real Nuxt process not observed')
}
try {
  await mkdir(path.dirname(out), { recursive: true })
  await save()
  const trust = await prepareEnvironment()
  stage = 'secure-test-admin-initialization'
  credentials = await initializeTestAdministrator()
  stage = 'trusted-browser-start'
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, true))
  stage = 'real-https-login'
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
  })
  page = await ctx.newPage()
  await page.goto(origin + '/admin/login')
  await page.locator('main input[name="username"]').fill(credentials.username)
  try {
    await page.locator('main input[name="password"]').fill(credentials.password)
  } catch {
    throw new Error('Secret input failed; omitted')
  }
  await page.getByRole('button', { name: '安全登录', exact: true }).click()
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  report.sourceRevision = process.env.V11_SOURCE_REVISION
  report.testWorkerImage = process.env.V11_BUILDER_ID
  report.testApiImage = {
    tag: testApiImage,
    id: cli('image', 'inspect', '--format', '{{.Id}}', testApiImage),
    sourceRevision: cli(
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
      testApiImage,
    ),
  }
  if (postfixApi) assert.match(report.testApiImage.sourceRevision, /^[a-f0-9]{40}$/)
  let initial = await read('/publishing-status')
  const jobs = (await read('/jobs')).items
  assert.ok(Array.isArray(jobs), 'Job list must follow the real API items contract')
  assert.ok(
    !jobs.some((j) => ['queued', 'running', 'reconciling'].includes(j.status)),
    'Existing uncertain task must be reconciled, never overwritten',
  )
  if (!initial.activeReleaseId) {
    const id = await submit()
    assert.equal((await waitTerminal(id, 360000)).status, 'succeeded')
    initial = await read('/publishing-status')
  }
  const before = await snapshot('before')
  report.originalActive = before.status.activeReleaseId
  report.originalHttp = await publicProof()
  if (name === 'baseline') {
    const id = await submit()
    assert.equal((await waitTerminal(id, 360000)).status, 'succeeded')
    await snapshot('after', id)
  } else if (['compile-error', 'timeout'].includes(name)) {
    await setWorker('none', name)
    const started = Date.now()
    const id = await submit()
    report.jobId = id
    await waitBuild(id)
    const job = await waitTerminal(id, name === 'timeout' ? 720000 : 240000)
    report.elapsedMilliseconds = Date.now() - started
    assert.equal(job.status, 'failed')
    assert.equal(job.error?.code, 'BUILD_FAILED')
    if (name === 'timeout') {
      report.taskElapsedMilliseconds = Date.parse(job.completedAt) - Date.parse(job.startedAt)
      assert.ok(report.taskElapsedMilliseconds >= 600000)
    }
    assert.deepEqual(await publicProof(), report.originalHttp)
    await snapshot('failed-with-old-site', id)
  } else if (name === 'enospc') {
    const id = await submit()
    report.jobId = id
    await waitBuild(id)
    const fill = compose(
      'exec',
      '-T',
      'worker',
      '/usr/local/bin/node',
      '-e',
      `const f=require('fs');const a=f.statfsSync('/work');const beforeAvailableBytes=a.bsize*a.bavail;const fd=f.openSync('/work/p6e-enospc-filler','wx');const b=Buffer.alloc(1024*1024);let n=0,writtenBytes=0;try{for(;n<1024;n++)writtenBytes+=f.writeSync(fd,b);process.exit(3)}catch(e){const z=f.statfsSync('/work');console.log(JSON.stringify({code:e.code,successfulWriteCalls:n,writtenBytes,beforeAvailableBytes,afterAvailableBytes:z.bsize*z.bavail}));if(e.code!=='ENOSPC')process.exit(4)}finally{f.closeSync(fd)}`,
    )
    report.kernelFailure = JSON.parse(fill)
    assert.equal(report.kernelFailure.code, 'ENOSPC')
    const job = await waitTerminal(id, 240000)
    assert.equal(job.status, 'failed')
    assert.deepEqual(await publicProof(), report.originalHttp)
    await snapshot('actual-enospc-with-old-site', id)
  } else if (['building-exit', 'api-restart'].includes(name)) {
    const id = await submit()
    report.jobId = id
    await waitBuild(id)
    if (name === 'building-exit') {
      compose('kill', '-s', 'SIGKILL', 'worker')
      await snapshot('worker-killed-during-build', id)
      assert.deepEqual(await publicProof(), report.originalHttp)
      await setWorker()
    } else {
      compose('restart', '-t', '2', 'api')
      compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'api')
      await event('api-restarted-during-real-build')
      await pause(2000)
    }
    const job =
      name === 'api-restart'
        ? await waitTerminalWithWorkerRestart(id)
        : await waitTerminal(id, 360000)
    if (name === 'building-exit') {
      assert.equal(job.status, 'failed')
      assert.equal(job.error?.code, 'INTERRUPTED_BEFORE_ACTIVATION')
      assert.deepEqual(await publicProof(), report.originalHttp)
    } else assert.ok(['failed', 'succeeded'].includes(job.status))
    await snapshot('recovered', id)
  } else if (
    ['before-switch', 'after-switch', 'static-restart', 'sqlite-commit-exit'].includes(name)
  ) {
    const mode =
      name === 'before-switch'
        ? 'before-current-rename'
        : name === 'sqlite-commit-exit'
          ? 'before-result-http'
          : 'after-current-rename'
    await setWorker(mode)
    const id = await submit()
    report.jobId = id
    await waitCheckpoint('worker', mode)
    await snapshot('at-activation-boundary', id)
    if (name === 'sqlite-commit-exit') {
      db('trigger-on')
      continueCheckpoint()
      await waitCheckpoint('api', 'sqlite-success-transaction')
      await event('sqlite-success-update-stopped-inside-transaction', { http: await publicProof() })
      compose('kill', '-s', 'SIGKILL', 'api')
      db('trigger-off')
      compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'api')
      compose('kill', '-s', 'SIGKILL', 'worker')
      await setWorker()
    } else if (name === 'static-restart') {
      compose('restart', '-t', '2', 'publication-static')
      await event('static-restarted-at-current-rename')
      continueCheckpoint()
    } else {
      compose('kill', '-s', 'SIGKILL', 'worker')
      await setWorker()
    }
    const job = await waitTerminal(id, 360000)
    if (name === 'before-switch') {
      assert.equal(job.status, 'failed')
      assert.deepEqual(await publicProof(), report.originalHttp)
    } else if (name === 'static-restart' && job.status === 'failed') {
      assert.equal(job.error?.code, 'ACTIVATION_RESTORED')
      assert.deepEqual(await publicProof(), report.originalHttp)
    } else assert.equal(job.status, 'succeeded')
    await snapshot('recovered-after-boundary', id)
  } else if (name === 'corrupt-history') {
    const history = (await read('/jobs')).items
    const target = history.find(
      (j) =>
        j.status === 'succeeded' &&
        j.kind === 'publish' &&
        j.releaseId !== before.status.activeReleaseId,
    )
    assert.ok(target, 'A distinct real successful Nuxt release is required')
    files('damage', target.releaseId)
    await event('historical-real-html-removed', { target: target.releaseId })
    try {
      await waitAvailable()
      await reauth()
      const w = await read('/workspace')
      const response = await post(
        '/rollback-jobs',
        {
          confirmAllChanges: true,
          reviewedActiveReleaseId: before.status.activeReleaseId,
          targetReleaseId: target.releaseId,
        },
        w.revision,
      )
      report.rejection = { status: response.status, error: response.error }
      if (response.status === 202) {
        report.jobId = response.data.jobId
        const job = await waitTerminal(report.jobId)
        assert.equal(job.status, 'failed')
      } else assert.ok([409, 422].includes(response.status))
      assert.deepEqual(await publicProof(), report.originalHttp)
      await snapshot('damaged-history-rejected', report.jobId)
    } finally {
      files('repair', target.releaseId)
      await event('historical-original-html-restored', {
        target: target.releaseId,
        filesystem: JSON.parse(files()),
      })
    }
  } else if (name === 'recovery-fails') {
    await configureWorker('before-result-http', 'normal', true)
    compose(
      'up',
      '-d',
      '--no-build',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '120',
      'api',
    )
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'worker')
    await waitAvailable()
    const id = await submit()
    report.jobId = id
    await waitCheckpoint('worker', 'before-result-http')
    await snapshot('new-release-active-before-verification', id)
    files('root-readonly')
    await event('real-filesystem-write-denied', {
      path: 'dedicated publications volume root',
      mode: '0500',
      reason: 'owner write permission removed after activation; images/releases untouched',
    })
    continueCheckpoint()
    async function waitRecoveryExit(minimumAttempts) {
      const until = Date.now() + 190000
      while (Date.now() < until) {
        const row = JSON.parse(db()).find((j) => j.id === id)
        const stopped =
          cli('inspect', '--format', '{{.State.Running}}', project + '-worker-1') === 'false'
        assert.notEqual(row.status, 'succeeded')
        if (
          row.attempts >= minimumAttempts &&
          row.status === 'reconciling' &&
          row.phase === 'recovery_required' &&
          stopped
        )
          return
        await pause(1000)
      }
      throw new Error('Expected rollback write denial and stopped Worker not observed')
    }
    await waitRecoveryExit(1)
    const first = await snapshot('rollback-write-failed-recovery-required', id)
    assert.notEqual(first.status.activeReleaseId, report.originalActive)
    assert.ok((await publicProof()).every((p) => p.status === 200))
    // The precise pre-result checkpoint has already been exercised. Retry
    // without it so only the unchanged real EACCES is the recovery fault.
    await configureWorker('none', 'normal', true)
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'worker')
    await waitRecoveryExit(2)
    await snapshot('second-rollback-write-also-failed', id)
    const workspace = await read('/workspace')
    const rejected = await post(
      '/publish-jobs',
      { confirmAllChanges: true, reviewedActiveReleaseId: first.status.activeReleaseId },
      workspace.revision,
    )
    assert.ok([409, 503].includes(rejected.status))
    report.newJobWhileUncertainRejected = rejected.status
    files('root-writable')
    report.filesystemPermissionRestoredByHarness = true
    await configureWorker()
    compose(
      'up',
      '-d',
      '--no-build',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '120',
      'api',
    )
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'worker')
    const job = await waitTerminal(id, 360000)
    assert.equal(job.status, 'succeeded')
    if (postfixApi) {
      assert.equal(job.error, null, 'Successful recovered API job must clear the old failure')
      const row = JSON.parse(db()).find((j) => j.id === id)
      assert.equal(row.errorCodeIsNull, true)
      assert.equal(row.errorSummaryIsNull, true)
      assert.ok(row.failureAuditEvents >= 2)
      assert.equal(row.successAuditEvents, 1)
      report.successDiagnosticCleared = true
      report.failureAuditEventsRetained = row.failureAuditEvents
    }
    await snapshot('same-activation-verified-after-explicit-operator-repair', id)
  } else if (name === 'http-unavailable') {
    await configureWorker('none', 'normal', true)
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'api')
    compose('restart', '-t', '2', 'worker')
    await pause(2000)
    await waitAvailable()
    const id = await submit()
    report.jobId = id
    async function recoveryBlocked() {
      const until = Date.now() + 360000
      while (Date.now() < until) {
        const j = (await read('/jobs/' + id)).job
        assert.notEqual(j.status, 'succeeded')
        if (j.status === 'reconciling' && j.phase === 'recovery_required') return
        await pause(1000)
      }
      throw new Error('Expected manual-recovery state not observed')
    }
    await recoveryBlocked()
    await snapshot('verification-unavailable-recovery-blocked', id)
    assert.deepEqual(await publicProof(), report.originalHttp)
    await configureWorker()
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'api')
    cli('start', project + '-worker-1')
    await pause(2000)
    const job = await waitTerminal(id, 360000)
    assert.equal(job.status, 'failed')
    assert.equal(job.error?.code, 'ACTIVATION_RESTORED')
    assert.deepEqual(await publicProof(), report.originalHttp)
    await snapshot('verifier-restored-same-task-confirmed-failed', id)
  }
  await setWorker()
  report.result = 'PASS'
  report.manualIntervention =
    'Harness operator restarted only named test services and removed test injection; no task, snapshot, current pointer, lease clock or successful release was rewritten to claim recovery. Production gate remains closed.'
} catch (error) {
  report.result = 'FAIL'
  report.failureStage = stage
  report.failureType = error?.name
  report.failure =
    error?.code === 'ERR_ASSERTION'
      ? error.message
      : 'Isolated real fault harness failed; secret-bearing command details omitted.'
  console.error(report.failure)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  try {
    stopBrowserContainer()
  } catch {
    // Preserve the original test failure if its dedicated browser is absent.
  }
  await save()
}
