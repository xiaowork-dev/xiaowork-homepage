// Read-only dependency/official-advisory evidence; no install, fix or deployment.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const evidence = path.resolve('docs/evidence')
const npmCLI = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const report = {
  date: new Date().toISOString(),
  scope: 'Read-only local locks and official upstream advisories; not a production inspection',
  workingSource: (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(),
  dependencies: {},
  audits: {},
  sources: [],
  limitations: [
    'Official registry/advisory data is time-dependent; preserved responses and hashes identify this observation.',
    'A clean advisory result does not prove absence of unknown, application-logic or operational vulnerabilities.',
    'Final image scans and source-target reachability are separate checks, not inferred from these lockfiles.',
  ],
}
for (const file of [
  'package-lock.json',
  'admin/package-lock.json',
  'backend/go.mod',
  'backend/go.sum',
])
  report.dependencies[file] = hash(await readFile(file))
for (const [role, directory] of [
  ['root', '.'],
  ['admin', 'admin'],
]) {
  let output
  let exit = 0
  try {
    output = await run(process.execPath, [npmCLI, 'audit', '--json'], {
      cwd: path.resolve(directory),
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 << 20,
    })
  } catch (error) {
    assert.equal(typeof error.code, 'number')
    exit = error.code
    output = { stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
  const file = `P6E-final-${role}-npm-audit.json`
  const parsed = JSON.parse(output.stdout)
  await writeFile(path.join(evidence, file), JSON.stringify(parsed, null, 2) + '\n')
  report.audits[role] = {
    exit,
    file,
    vulnerabilities: parsed.metadata?.vulnerabilities,
    error: parsed.error,
  }
}
const urls = [
  [
    'alpine-3.24-musl',
    'https://raw.githubusercontent.com/alpinelinux/aports/3.24-stable/main/musl/APKBUILD',
    'text',
  ],
  [
    'alpine-edge-musl',
    'https://raw.githubusercontent.com/alpinelinux/aports/master/main/musl/APKBUILD',
    'text',
  ],
  ['alpine-3.24-secdb', 'https://secdb.alpinelinux.org/v3.24/main.json', 'secdb'],
  ['alpine-musl-tracker', 'https://security.alpinelinux.org/vuln/CVE-2026-107891', 'text'],
  ['deepmerge-advisory', 'https://api.github.com/advisories/GHSA-gcqx-w48m-w2h4', 'json'],
  ['go-openpgp-advisory', 'https://vuln.go.dev/ID/GO-2026-5932.json', 'json'],
  ['deepmerge-registry', 'https://registry.npmjs.org/deepmerge/latest', 'registry'],
  ['node-forge-registry', 'https://registry.npmjs.org/node-forge/latest', 'registry'],
]
for (const [name, url, kind] of urls) {
  const observation = { name, url, checkedAt: new Date().toISOString() }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(45000),
      headers: { 'User-Agent': 'XiaoWork-local-P6E-advisory-review' },
    })
    const text = await response.text()
    Object.assign(observation, {
      status: response.status,
      lastModified: response.headers.get('last-modified'),
      responseSha256: hash(text),
    })
    assert.equal(response.status, 200)
    let preserved = text
    let extension = 'txt'
    if (kind !== 'text') {
      let data = JSON.parse(text)
      if (kind === 'secdb')
        data = {
          distroversion: data.distroversion,
          reponame: data.reponame,
          packages: data.packages.filter((entry) => entry.pkg?.name === 'musl'),
        }
      if (kind === 'registry')
        data = {
          name: data.name,
          version: data.version,
          gitHead: data.gitHead,
          dist: data.dist,
          repository: data.repository,
        }
      preserved = JSON.stringify(data, null, 2) + '\n'
      extension = 'json'
    }
    observation.file = `P6E-final-${name}.${extension}`
    await writeFile(path.join(evidence, observation.file), preserved.replace(/\r\n/g, '\n'))
    observation.evidenceSha256 = hash(await readFile(path.join(evidence, observation.file)))
  } catch (error) {
    observation.result = 'SOURCE_UNAVAILABLE_NOT_VERIFIED'
    observation.error = error.name
  }
  report.sources.push(observation)
}
report.result =
  report.sources.every((entry) => entry.status === 200 && entry.file) &&
  Object.values(report.audits).every((entry) => entry.vulnerabilities)
    ? 'COLLECTED'
    : 'INCOMPLETE'
await writeFile(
  path.join(evidence, 'P6E-final-dependency-recheck.json'),
  JSON.stringify(report, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    result: report.result,
    audits: report.audits,
    sources: report.sources.map(({ name, status, result }) => ({ name, status, result })),
  }),
)
