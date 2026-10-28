// Local synthetic 25M-pixel acceptance; no production or real project image.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import http from 'node:http'
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
} from './p6e-browser-environment.mjs'

const cli = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
const requireAdmin = createRequire(path.resolve('admin/package.json'))
const { chromium } = requireAdmin('playwright-core')
const report = {
  date: new Date().toISOString(),
  project,
  origin,
  fixture: 'Locally generated low-entropy 5000 x 5000 PNG; not a project screenshot',
  limitations:
    'Docker one-second sampled memory includes cache; not a proof of absolute peak or all 25M-pixel inputs',
  tlsVerificationDisabled: false,
  samples: [],
}
let browser, stats, credentials
try {
  const trust = await prepareEnvironment()
  credentials = await initializeTestAdministrator()
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, true))
  const context = await browser.newContext({ ignoreHTTPSErrors: false })
  const page = await context.newPage()
  await page.goto(origin + '/admin/login')
  const form = page.getByRole('main')
  await form.getByLabel('管理员账户', { exact: true }).fill(credentials.username)
  try {
    await form.locator('input[name="password"]').fill(credentials.password)
  } catch {
    throw new Error('Secure password control failed; value omitted')
  }
  await form.getByRole('button', { name: '安全登录' }).click()
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  const container = compose('ps', '-q', 'api')
  assert.equal(
    cli('inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', container),
    project,
  )
  const version = cli('version', '--format', '{{.Server.APIVersion}}')
  report.memoryLimit = Number(cli('inspect', '--format', '{{.HostConfig.Memory}}', container))
  let buffer = ''
  stats = http.get(
    {
      socketPath: '\\\\.\\pipe\\dockerDesktopLinuxEngine',
      path: `/v${version}/containers/${container}/stats?stream=true`,
    },
    (res) => {
      assert.equal(res.statusCode, 200)
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buffer += chunk
        for (let end; (end = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, end).trim()
          buffer = buffer.slice(end + 1)
          if (!line) continue
          const sample = JSON.parse(line)
          report.samples.push({
            at: sample.read,
            memoryBytes: sample.memory_stats?.usage,
            cpuNanoseconds: sample.cpu_stats?.cpu_usage?.total_usage,
          })
        }
      })
    },
  )
  stats.on('error', () => {
    report.statsError = 'Docker statistics stream unavailable'
  })
  await new Promise((resolve) => setTimeout(resolve, 2200))
  const started = Date.now()
  report.upload = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 5000
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#52408f'
    ctx.fillRect(0, 0, 5000, 5000)
    ctx.fillStyle = '#e8dccb'
    ctx.fillRect(0, 0, 2500, 2500)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const workspace = (await (await fetch('/api/admin/v1/workspace')).json()).data
    const session = (await (await fetch('/api/admin/v1/auth/session')).json()).data
    const form = new FormData()
    form.append('file', blob, 'local-synthetic-25m.png')
    const response = await fetch('/api/admin/v1/media', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken, 'If-Match': '"' + workspace.revision + '"' },
      body: form,
    })
    const data = await response.json()
    const media = data.data?.media
    if (response.status !== 201) return { status: response.status, code: data.error?.code }
    const next = (await (await fetch('/api/admin/v1/workspace')).json()).data
    const cleanup = await fetch('/api/admin/v1/media/' + media.id, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': session.csrfToken, 'If-Match': '"' + next.revision + '"' },
    })
    return {
      status: response.status,
      width: media.width,
      height: media.height,
      originalBytes: blob.size,
      outputBytes: media.byteSize,
      unreferencedSoftDeleteStatus: cleanup.status,
    }
  })
  report.elapsedMs = Date.now() - started
  await new Promise((resolve) => setTimeout(resolve, 2200))
  assert.equal(report.upload.status, 201)
  assert.equal(report.upload.width, 5000)
  assert.equal(report.upload.height, 5000)
  assert.equal(report.upload.unreferencedSoftDeleteStatus, 200)
  assert.ok(report.samples.length >= 3)
  report.maximumObservedMemoryBytes = Math.max(
    ...report.samples.map((sample) => sample.memoryBytes ?? 0),
  )
  report.oomKilled = cli('inspect', '--format', '{{.State.OOMKilled}}', container) === 'true'
  assert.equal(report.oomKilled, false)
  assert.ok(report.maximumObservedMemoryBytes <= report.memoryLimit)
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.error = String(error.message).replaceAll(credentials?.password || '\u0000', '[redacted]')
  process.exitCode = 1
} finally {
  stats?.destroy()
  if (browser) await browser.close()
  stopBrowserContainer()
  await writeFile('docs/evidence/P6E-media-peak.json', JSON.stringify(report, null, 2) + '\n')
  console.log(report.result + ' synthetic 25M-pixel local upload; see P6E-media-peak.json')
}
