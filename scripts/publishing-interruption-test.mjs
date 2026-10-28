// Real Nuxt/Worker interruption in the fixed local P6-D E2E project only.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  compose,
  initializeTestAdministrator,
  origin,
  prepareEnvironment,
  project,
  startBrowserContainer,
  stopBrowserContainer,
} from './publishing-browser-environment.mjs'

const { chromium } = createRequire(path.resolve('admin/package.json'))('playwright-core')
const api = '/api/admin/v1'
const worker = `${project}-worker-1`
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const report = {
  date: new Date().toISOString(),
  project,
  tlsVerificationDisabled: false,
  cases: [],
  samples: [],
}
let browser, page, credentials
function record(name, detail) {
  report.cases.push({ name, detail, result: 'PASS' })
  console.log('PASS ' + name)
}
async function read(route) {
  return page.evaluate(async (endpoint) => {
    const r = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
    if (!r.ok) throw new Error('Authenticated fault test read rejected: ' + r.status)
    return (await r.json()).data
  }, api + route)
}
async function submit(revision, active) {
  return page.evaluate(
    async ({ api, revision, active, key }) => {
      const session = await (await fetch(api + '/auth/session', { cache: 'no-store' })).json()
      const r = await fetch(api + '/publish-jobs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.data.csrfToken,
          'If-Match': '"' + revision + '"',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ confirmAllChanges: true, reviewedActiveReleaseId: active }),
      })
      const result = await r.json()
      return { status: r.status, jobId: result.data?.jobId, errorCode: result.error?.code }
    },
    { api, revision, active, key: 'interruption-' + randomBytes(16).toString('hex') },
  )
}
async function publicProof() {
  const files = []
  for (const route of ['/', '/projects/', '/about/', '/__xiaowork-release.json']) {
    const r = await fetch('http://127.0.0.1:3212' + route, { cache: 'no-store' })
    assert.equal(r.status, 200)
    files.push({
      route,
      status: r.status,
      sha256: createHash('sha256')
        .update(Buffer.from(await r.arrayBuffer()))
        .digest('hex'),
    })
  }
  return files
}
try {
  const trust = await prepareEnvironment()
  credentials = await initializeTestAdministrator()
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, true))
  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
  })
  page = await context.newPage()
  await page.goto(origin + '/admin/login')
  await page.locator('main input[name="username"]').fill(credentials.username)
  try {
    await page.locator('main input[name="password"]').fill(credentials.password)
  } catch {
    throw new Error('Secure test password input failed; value omitted')
  }
  await page.getByRole('button', { name: '安全登录', exact: true }).click()
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  const draft = await read('/workspace')
  const before = await read('/publishing-status')
  assert.ok(before.activeVerified && before.activeReleaseId)
  report.activeReleaseId = before.activeReleaseId
  report.draftRevision = draft.revision
  report.publicBefore = await publicProof()
  const queued = await submit(draft.revision, before.activeReleaseId)
  assert.equal(queued.status, 202)
  report.jobId = queued.jobId
  let seenBuild = false
  for (let i = 0; i < 80; i++) {
    const { job } = await read('/jobs/' + queued.jobId)
    if (job.status === 'running' && job.phase === 'building') {
      const processes = execFileSync('docker', ['top', worker, '-eo', 'pid,args'], {
        encoding: 'utf8',
      })
        .trim()
        .split(/\r?\n/)
        .slice(1)
      // Node may name its main thread MainThread. Identify the fixed command
      // and generated job directory, not an unreliable OS comm label.
      if (
        processes.some((line) =>
          line.includes('/builder/node_modules/nuxt/bin/nuxt.mjs generate /work/' + queued.jobId),
        )
      ) {
        report.observedProcesses = ['fixed Nuxt generator for the exact queued job']
        seenBuild = true
        break
      }
    }
    assert.ok(
      ['queued', 'running'].includes(job.status),
      'Task ended before the intended interruption: ' +
        job.status +
        '/' +
        (job.error?.code ?? 'none'),
    )
    await pause(100)
  }
  assert.ok(seenBuild, 'Must observe the real fixed Nuxt Node process before killing')
  compose('kill', '-s', 'SIGKILL', 'worker')
  const immediate = await read('/jobs/' + queued.jobId)
  assert.notEqual(immediate.job.status, 'succeeded')
  assert.deepEqual(await publicProof(), report.publicBefore)
  const concurrent = await submit(draft.revision, before.activeReleaseId)
  assert.equal(concurrent.status, 409)
  record(
    '真实 Nuxt 构建中 SIGKILL Worker',
    'Observed Node process; old public HTML and version bytes unchanged; overlapping job rejected409',
  )
  // Availability expires after 45 real seconds; do not rewrite database time.
  const availabilityDeadline = Date.now() + 55000
  while ((await read('/publishing-status')).workerAvailable && Date.now() < availabilityDeadline)
    await pause(1000)
  assert.equal((await read('/publishing-status')).workerAvailable, false)
  const unavailable = await submit(draft.revision, before.activeReleaseId)
  assert.equal(unavailable.status, 503)
  record(
    '真实 Worker 停机后拒绝任务',
    'Availability elapsed in real time; authenticated CSRF-protected request503; no fake success',
  )
  compose('start', 'worker')
  // The actual 120-second lease must expire. Do not shorten runtime policy.
  const recoveryDeadline = Date.now() + 150000
  let terminal
  while (Date.now() < recoveryDeadline) {
    const { job } = await read('/jobs/' + queued.jobId)
    const sample = { status: job.status, phase: job.phase, errorCode: job.error?.code ?? null }
    if (JSON.stringify(report.samples.at(-1)) !== JSON.stringify(sample))
      report.samples.push(sample)
    assert.notEqual(
      job.status,
      'succeeded',
      'Interrupted unprepared candidate must never be reported successful',
    )
    if (job.status === 'failed') {
      terminal = job
      break
    }
    await pause(1000)
  }
  assert.equal(terminal?.error?.code, 'INTERRUPTED_BEFORE_ACTIVATION')
  const after = await read('/publishing-status')
  const draftAfter = await read('/workspace')
  assert.equal(after.activeReleaseId, before.activeReleaseId)
  assert.equal(after.activeVerified, true)
  assert.equal(draftAfter.revision, draft.revision)
  report.publicAfter = await publicProof()
  assert.deepEqual(report.publicAfter, report.publicBefore)
  report.finalJob = {
    id: terminal.id,
    status: terminal.status,
    phase: terminal.phase,
    error: terminal.error,
    completedAt: terminal.completedAt,
  }
  await page.goto(origin + '/admin/publishing')
  await page.locator('.publication-list li').filter({ hasText: queued.jobId }).first().waitFor()
  assert.equal(
    await page
      .locator('input[type="password"]')
      .evaluateAll((nodes) => nodes.some((node) => node.value)),
    false,
  )
  await page.screenshot({
    path: 'docs/evidence/P6D-worker-interruption.png',
    fullPage: true,
    animations: 'disabled',
  })
  record(
    '重启后同任务按真实租约恢复核对',
    'Original task failed before activation; current HTML/version and draft remain unchanged; no rebuild or duplicate success',
  )
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  // Only own assertions are safe to persist. Tool commands may include a
  // secret locator or unrelated Docker metadata, so use a fixed fallback.
  report.failure =
    error?.code === 'ERR_ASSERTION'
      ? error.message
      : 'Real isolated interruption test failed; no secret-bearing tool error recorded.'
  console.error(report.failure)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  stopBrowserContainer()
  report.certificateTrustRemoved = true
  await writeFile(
    'docs/evidence/P6D-worker-interruption.json',
    JSON.stringify(report, null, 2) + '\n',
  )
}
