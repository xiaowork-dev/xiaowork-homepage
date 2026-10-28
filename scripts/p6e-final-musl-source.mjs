// Alternate official-source retrieval, preserving earlier HTTP/network failures.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
const report = { date: new Date().toISOString(), sources: [], result: 'IN_PROGRESS' }
for (const ref of ['3.24-stable', 'master']) {
  const url = `https://api.github.com/repos/alpinelinux/aports/contents/main/musl/APKBUILD?ref=${ref}`
  const source = { ref, url, checkedAt: new Date().toISOString() }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(45000),
      headers: { 'User-Agent': 'XiaoWork-local-P6E-advisory-review' },
    })
    source.status = response.status
    assert.equal(response.status, 200)
    const value = await response.json()
    assert.equal(value.encoding, 'base64')
    const contents = Buffer.from(value.content, 'base64').toString('utf8')
    Object.assign(source, {
      blobSha: value.sha,
      sha256: createHash('sha256').update(contents).digest('hex'),
      versions: contents.match(/^pkg(?:ver|rel)=.*$/gm),
      file: `P6E-final-musl-${ref}-APKBUILD.txt`,
    })
    await writeFile(`docs/evidence/${source.file}`, contents.replace(/\r\n/g, '\n'))
    source.result = 'FETCHED'
  } catch (error) {
    source.result = 'SOURCE_UNAVAILABLE_NOT_VERIFIED'
    source.error = error.name
  }
  report.sources.push(source)
}
report.result = report.sources.every((source) => source.result === 'FETCHED')
  ? 'COLLECTED'
  : 'INCOMPLETE'
if (report.result === 'COLLECTED') {
  const patch = 'CVE-2026-107891.patch'
  const url = `https://api.github.com/repos/alpinelinux/aports/contents/main/musl/${patch}?ref=3.24-stable`
  const observation = { name: patch, url, checkedAt: new Date().toISOString() }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(45000),
      headers: { 'User-Agent': 'XiaoWork-local-P6E-advisory-review' },
    })
    observation.status = response.status
    assert.equal(response.status, 200)
    const value = await response.json()
    assert.equal(value.encoding, 'base64')
    const bytes = Buffer.from(value.content, 'base64')
    const sha512 = createHash('sha512').update(bytes).digest('hex')
    const builds = await Promise.all(
      report.sources.map((source) => readFile(`docs/evidence/${source.file}`, 'utf8')),
    )
    assert.ok(
      builds.every((contents) => contents.includes(`${sha512}  ${patch}`)),
      'Both branches must identify the same security patch bytes',
    )
    Object.assign(observation, {
      blobSha: value.sha,
      sha512,
      bothBranchChecksumsMatch: true,
      file: 'P6E-final-musl-security-patch.txt',
      result: 'PATCH_MATCH_CONFIRMED',
    })
    await writeFile(`docs/evidence/${observation.file}`, bytes)
  } catch (error) {
    observation.result = 'SOURCE_UNAVAILABLE_NOT_VERIFIED'
    observation.error = error.name
    report.result = 'INCOMPLETE'
  }
  report.patch = observation
}
await writeFile('docs/evidence/P6E-final-musl-source.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
