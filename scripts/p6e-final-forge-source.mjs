// Verify the pinned version separately from the moving npm latest dist-tag.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
const report = { date: new Date().toISOString(), sources: [], result: 'IN_PROGRESS' }
const urls = [
  ['node-forge-pinned-registry', 'https://registry.npmjs.org/node-forge/1.4.1', 'registry'],
  [
    'node-forge-1.4.2-release',
    'https://api.github.com/repos/digitalbazaar/forge/releases/tags/v1.4.2',
    'json',
  ],
  [
    'node-forge-1.4.2-changelog',
    'https://api.github.com/repos/digitalbazaar/forge/contents/CHANGELOG.md?ref=v1.4.2',
    'contents',
  ],
  ['node-forge-advisory', 'https://api.github.com/advisories/GHSA-86w9-cpqp-85rv', 'json'],
]
for (const [name, url, kind] of urls) {
  const source = { name, url, checkedAt: new Date().toISOString() }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(45000),
      headers: { 'User-Agent': 'XiaoWork-local-P6E-advisory-review' },
    })
    source.status = response.status
    assert.equal(response.status, 200)
    let value = await response.json()
    if (kind === 'registry')
      value = {
        name: value.name,
        version: value.version,
        gitHead: value.gitHead,
        dist: value.dist,
        repository: value.repository,
      }
    const contents =
      kind === 'contents'
        ? Buffer.from(value.content, 'base64').toString('utf8')
        : JSON.stringify(value, null, 2) + '\n'
    source.file = `P6E-final-${name}.${kind === 'contents' ? 'txt' : 'json'}`
    await writeFile(`docs/evidence/${source.file}`, contents.replace(/\r\n/g, '\n'))
    source.sha256 = createHash('sha256')
      .update(await readFile(`docs/evidence/${source.file}`))
      .digest('hex')
    source.result = 'FETCHED'
  } catch (error) {
    source.result = 'SOURCE_UNAVAILABLE_NOT_VERIFIED'
    source.error = error.name
  }
  report.sources.push(source)
}
report.result = report.sources.every((source) => source.result === 'FETCHED')
  ? 'COLLECTED'
  : 'PARTIAL'
await writeFile('docs/evidence/P6E-final-forge-source.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
