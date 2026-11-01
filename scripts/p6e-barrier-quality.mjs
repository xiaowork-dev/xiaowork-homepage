// Current source/lockfile checks; does not scan old images as a new release.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const file = 'docs/evidence/P6E-barrier-quality.json'
assert.ok(!fs.existsSync(file))
const report = {
  at: new Date().toISOString(),
  commands: [],
  risks: [],
  images: 'NOT_REBUILT; chain4 Scout findings retained, not a new candidate scan',
}
const hash = (b) => createHash('sha256').update(b).digest('hex')
function command(executable, args, options = {}) {
  const r = spawnSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180000,
    ...options,
  })
  const entry = {
    executable,
    args,
    exitCode: r.status,
    signal: r.signal,
    error: r.error?.message,
    stdout: r.stdout,
    stderr: r.stderr,
  }
  report.commands.push(entry)
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
  return entry
}
const node = process.execPath
const changed = command('git', ['diff', '--name-only']).stdout.trim().split(/\r?\n/)
const untracked = command('git', ['ls-files', '--others', '--exclude-standard'])
  .stdout.trim()
  .split(/\r?\n/)
const scripts = [...new Set([...changed, ...untracked])].filter(
  (f) => f.startsWith('scripts/') && f.endsWith('.mjs'),
)
command(node, [
  'node_modules/prettier/bin/prettier.cjs',
  '--check',
  ...scripts,
  'compose.admin-publish.yaml',
  'compose.admin-dev.yaml',
])
command(node, ['node_modules/eslint/bin/eslint.js', ...scripts, '--max-warnings', '0'])
command(node, ['--test', 'scripts/v11-chain.test.mjs', 'scripts/v11-release.test.mjs'])
const npmCLI = process.env.P6E_NPM_CLI ?? 'C:/dev/nodejs24/node_modules/npm/bin/npm-cli.js'
for (const [scope, prefix] of [
  ['root', ''],
  ['admin', 'admin'],
]) {
  const directory = path.resolve(prefix || '.')
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json')))
  const audit = command(node, [npmCLI, 'audit', '--json', '--ignore-scripts'], { cwd: directory })
  try {
    const json = JSON.parse(audit.stdout)
    report[scope + 'AuditCounts'] = json.metadata?.vulnerabilities
    for (const [name, risk] of Object.entries(json.vulnerabilities ?? {})) {
      report.risks.push({
        scope,
        package: name,
        severity: risk.severity,
        direct: risk.isDirect,
        range: risk.range,
        fixAvailable: risk.fixAvailable,
        installed: risk.nodes.map((where) => ({ where, version: lock.packages[where]?.version })),
        advisories: risk.via,
        disposition: /nuxt|vite|rollup/.test(name)
          ? 'Builder actually runs fixed Nuxt generate; dev-server exploit reachability not proven absent. Compatible Nuxt patch needs new six-role build/browser/publish validation; unresolved, production remains blocked.'
          : /glob|minimatch/.test(name)
            ? 'Build/lint graph. No public arbitrary pattern/script API. Suggested major-version fixes require contract and build tests; no force override, unresolved.'
            : /deepmerge/.test(name)
              ? 'Build graph, no compatible official fix in chain4 source evidence. Restricted offline Worker and strict snapshot inputs mitigate; not fixed.'
              : 'Transitive build/lint dependency. Keep exact chain and advisory; cannot infer safe solely from static final Nginx.',
      })
    }
  } catch (error) {
    report[scope + 'AuditError'] = error.message
  }
}
const env = {
  ...process.env,
  PATH: 'C:/dev/Go/go/bin;' + process.env.PATH,
  GOOS: 'linux',
  GOARCH: 'amd64',
  CGO_ENABLED: '0',
  GOPROXY: 'off',
  GOTOOLCHAIN: 'local',
  GOCACHE: path.resolve('.cache/p6e-barrier-govuln-cache'),
}
const entries = [
  './cmd/homepage-api',
  './cmd/homepage-worker',
  './cmd/homepage-maintenance',
  './cmd/homepage-control',
]
const imports = command('C:/dev/Go/go/bin/go.exe', ['list', '-deps', ...entries], {
  cwd: path.resolve('backend'),
  env,
})
report.openPGPImported = /golang.org\/x\/crypto\/openpgp/.test(imports.stdout ?? '')
command(path.resolve('.cache/p6e-go/bin/govulncheck.exe'), ['-show=verbose', ...entries], {
  cwd: path.resolve('backend'),
  env,
  timeout: 240000,
})
report.inputs = {}
for (const f of [
  'package.json',
  'package-lock.json',
  'admin/package.json',
  'admin/package-lock.json',
  'backend/go.mod',
  'backend/go.sum',
])
  report.inputs[f] = hash(fs.readFileSync(f))
report.workerPriorFindings = JSON.parse(
  fs.readFileSync('docs/evidence/P6E-chain4-security-audit.json'),
).images.find((x) => x.role === 'worker')
report.upstreamEvidence =
  'P6E-chain4-upstream.json (2026-11-01; retained evidence, not new network verification)'
report.result = 'CHECK_RESULTS_INDIVIDUALLY; npm findings and unbuilt final images remain blockers'
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify({
    file,
    commands: report.commands.map((c) => ({
      exe: c.executable,
      args: c.args,
      exitCode: c.exitCode,
      signal: c.signal,
    })),
    npm: [report.rootAuditCounts, report.adminAuditCounts],
    openPGPImported: report.openPGPImported,
  }),
)
