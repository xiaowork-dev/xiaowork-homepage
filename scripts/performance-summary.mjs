import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const directory = 'docs/evidence'
const metrics = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'total-blocking-time',
  'speed-index',
]
const runs = fs
  .readdirSync(directory)
  .filter((file) => /^P4-(baseline|final)-.*\.json$/.test(file))
  .sort()
  .map((file) => {
    const report = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
    return {
      file,
      url: report.finalDisplayedUrl,
      fetchedAt: report.fetchTime,
      lighthouse: report.lighthouseVersion,
      browser: report.environment.hostUserAgent,
      settings: {
        formFactor: report.configSettings.formFactor,
        throttlingMethod: report.configSettings.throttlingMethod,
        throttling: report.configSettings.throttling,
      },
      scores: Object.fromEntries(
        Object.entries(report.categories).map(([key, value]) => [key, value.score * 100]),
      ),
      metrics: Object.fromEntries(metrics.map((key) => [key, report.audits[key]?.numericValue])),
      transferredBytes: report.audits['total-byte-weight'].numericValue,
      failedAudits: Object.values(report.audits)
        .filter((audit) => audit.score === 0)
        .map((audit) => ({ id: audit.id, title: audit.title })),
    }
  })
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const comparisons = Object.fromEntries(
  ['baseline', 'final'].map((phase) => {
    const selected = runs.filter((run) => run.file.includes(`${phase}-mobile-`))
    return [
      phase,
      selected.length
        ? {
            runs: selected.length,
            performance: median(selected.map((run) => run.scores.performance)),
            metrics: Object.fromEntries(
              metrics.map((key) => [key, median(selected.map((run) => run.metrics[key]))]),
            ),
            transferredBytes: median(selected.map((run) => run.transferredBytes)),
          }
        : null,
    ]
  }),
)
const assets = fs
  .readdirSync('.output/public/_nuxt')
  .filter((file) => /\.(js|css)$/.test(file))
  .map((file) => {
    const bytes = fs.readFileSync(path.join('.output/public/_nuxt', file))
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length }
  })
const result = {
  note: 'Lighthouse navigation lab results; TBT is not INP. No real-user INP/CrUX data without a confirmed public origin. Asset totals include lazy route and error chunks, not just initial transfer.',
  comparisons,
  runs,
  assets,
}
fs.writeFileSync(
  path.join(directory, 'P4-performance-summary.json'),
  JSON.stringify(result, null, 2) + '\n',
)
console.log(
  JSON.stringify(
    {
      comparisons,
      assets: assets.reduce(
        (sum, asset) => ({
          bytes: sum.bytes + asset.bytes,
          gzipBytes: sum.gzipBytes + asset.gzipBytes,
        }),
        { bytes: 0, gzipBytes: 0 },
      ),
    },
    null,
    2,
  ),
)
