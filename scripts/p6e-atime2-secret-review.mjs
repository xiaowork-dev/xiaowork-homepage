// Exact-value review of redacted generic-api-key matches; no rule suppression.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
const hash = (b) => createHash('sha256').update(b).digest('hex')
const previous = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime2-repository-secret-scan.json'))
assert.equal(previous.result, 'REVIEW_REQUIRED')
const base = '.cache/p6e-repository-scan'
const latest = path.join(base, fs.readdirSync(base).sort().at(-1))
const raw = JSON.parse(fs.readFileSync(path.join(latest, 'report/findings.json')))
assert.equal(raw.length, previous.findings.length)
const manifests = [
  'P6E-ro-runtime-manifest.json',
  'P6E-atime-runtime-manifest.json',
  'P6E-atime2-runtime-manifest.json',
].map((file) => ({ file, ...JSON.parse(fs.readFileSync('docs/evidence/' + file)) }))
const tags = [
  'xiaowork-homepage-api:p6e-diagnostics-aa23376',
  ...manifests.map((m) => m.images.api.tag),
]
const ids = manifests.map((m) => m.images.api.id)
const reviewed = raw.map((f) => {
  const file = f.File.replace(/^\/source\//, '')
  const original = fs.readFileSync(path.join(latest, 'source', file))
  assert.equal(hash(fs.readFileSync(file)), hash(original), 'Finding input changed')
  const line = original.toString().split(/\r?\n/)[f.StartLine - 1]
  assert.equal(f.RuleID, 'generic-api-key')
  assert.equal(f.Secret, 'REDACTED')
  assert.equal(f.StartLine, f.EndLine)
  let disposition
  for (const tag of tags)
    if (
      line.includes(tag) &&
      line.replaceAll(tag, 'xiaowork-homepage-api:REDACTED').includes(f.Match.trimEnd())
    )
      disposition = 'EXACT_PUBLIC_LOCAL_IMAGE_TAG'
  for (const id of ids)
    if (
      line.includes('api ' + id) &&
      line.replaceAll('api ' + id, 'api sha256:REDACTED').includes(f.Match.trimEnd())
    )
      disposition = 'EXACT_MANIFEST_API_IMAGE_ID'
  assert.ok(disposition, 'Unreviewed redacted finding at ' + file + ':' + f.StartLine)
  return { file, line: f.StartLine, inputSHA256: hash(original), disposition }
})
const output = 'docs/evidence/P6E-atime2-repository-secret-review.json'
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      source: 'bb05f6ad613fdf3507ff8a9c56696da85fa4a678',
      result: 'REVIEWED_PUBLIC_IMAGE_ID_AND_TAG_FALSE_POSITIVES',
      scannerExitPreserved: previous.scanExit,
      rawReportSHA256: hash(fs.readFileSync(path.join(latest, 'report/findings.json'))),
      originalScanReport: 'P6E-atime2-repository-secret-scan.json',
      findingCount: reviewed.length,
      reviewed,
      limitations:
        'Exact findings reconstructed from scanned bytes and pinned public image manifests; no blanket path/rule allowlist. Scanner nonzero and original unreviewed result remain preserved. This is not a guarantee of absence of unknown secrets.',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
)
console.log('PASS exact-value review; original nonzero scanner findings preserved')
