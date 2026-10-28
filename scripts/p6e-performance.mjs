// Actual local static release Lighthouse navigation measurements only.
// Install the pinned audit tool in .cache/p6e-lighthouse; it is not an app dependency.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const origin = 'http://127.0.0.1:3214'
const directory = path.resolve('docs/evidence')
const cli = path.resolve('.cache/p6e-lighthouse/node_modules/lighthouse/cli/index.js')
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const tool = JSON.parse(
  await readFile('.cache/p6e-lighthouse/node_modules/lighthouse/package.json', 'utf8'),
)
assert.equal(tool.version, '13.6.0')
const getVersion = async () => {
  const response = await fetch(origin + '/__xiaowork-release.json', { cache: 'no-store' })
  assert.equal(response.status, 200, 'A real published release must be active before auditing')
  const value = await response.json()
  assert.match(value.releaseId, /^rel_[a-f0-9]{32}$/)
  return value
}
const version = await getVersion()
const report = {
  date: new Date().toISOString(),
  origin,
  version,
  scope: 'Local gateway HTTP on trustworthy loopback; no production or admin credentials',
  tool: { name: 'Lighthouse', version: tool.version },
  runs: [],
  limitations: [
    'Navigation lab measurements; TBT is not INP. No real-user INP or CrUX claim.',
    'Local Docker Desktop and simulated throttling are not a production network benchmark.',
    'No comparable P6-D Lighthouse baseline exists; older P5 reports use different tools/content.',
    'A zero Lighthouse error count does not replace credentialed management browser tests.',
    'The fixture is an isolated published test snapshot with a synthetic cover, not verified production project content.',
  ],
}
const cases = [
  ['home-mobile-1', '/', false],
  ['home-mobile-2', '/', false],
  ['home-mobile-3', '/', false],
  ['projects-mobile', '/projects/', false],
  ['about-mobile', '/about/', false],
  ['home-desktop', '/', true],
]
const metrics = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'total-blocking-time',
  'speed-index',
]
for (const [name, route, desktop] of cases) {
  const output = path.join(directory, `P6E-lighthouse-${name}.json`)
  const args = [
    cli,
    origin + route,
    '--output=json',
    '--output-path=' + output,
    '--only-categories=performance,accessibility,best-practices,seo',
    '--chrome-flags=--headless=new --disable-dev-shm-usage --no-first-run --disable-extensions',
    '--quiet',
  ]
  if (desktop) args.push('--preset=desktop')
  await run(process.execPath, args, {
    timeout: 120000,
    maxBuffer: 4 << 20,
    env: { ...process.env, CHROME_PATH: chrome },
  })
  const result = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(result.runtimeError, undefined, `${name} measurement must succeed`)
  assert.equal(result.finalDisplayedUrl, origin + route)
  assert.equal(result.audits['http-status-code'].score, 1)
  report.runs.push({
    file: path.basename(output),
    fetchTime: result.fetchTime,
    browser: result.environment.hostUserAgent,
    runWarnings: result.runWarnings,
    scores: Object.fromEntries(
      Object.entries(result.categories).map(([key, value]) => [key, value.score * 100]),
    ),
    metrics: Object.fromEntries(metrics.map((key) => [key, result.audits[key]?.numericValue])),
    transferBytes: result.audits['total-byte-weight'].numericValue,
    jsBytes: result.audits['resource-summary'].details.items.find(
      (x) => x.resourceType === 'script',
    )?.transferSize,
    cssBytes: result.audits['resource-summary'].details.items.find(
      (x) => x.resourceType === 'stylesheet',
    )?.transferSize,
    failedAudits: Object.values(result.audits)
      .filter((audit) => audit.score === 0)
      .map((audit) => ({ id: audit.id, title: audit.title })),
  })
  console.log(`Measured ${name}`)
}
assert.deepEqual(await getVersion(), version, 'The release must remain unchanged across all runs')
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const home = report.runs.filter((value) => /home-mobile/.test(value.file))
report.homeMobileMedian = {
  score: median(home.map((value) => value.scores.performance)),
  metrics: Object.fromEntries(
    metrics.map((key) => [key, median(home.map((value) => value.metrics[key]))]),
  ),
}
report.result = 'MEASURED'
await writeFile(
  path.join(directory, 'P6E-performance-summary.json'),
  JSON.stringify(report, null, 2) + '\n',
)
console.log(JSON.stringify(report, null, 2))
