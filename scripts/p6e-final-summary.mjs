// Evidence index only. No runtime, production, data or failure state is mutated.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

const source = '817aa533741bdd5de23f322fa5e5171442cb28a9'
const read = (name) => JSON.parse(fs.readFileSync('docs/evidence/' + name + '.json', 'utf8'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
assert.equal(git('branch', '--show-current'), 'feat/v1.1-admin-p6a')
const manifest = read('P6E-final-runtime-manifest')
assert.equal(manifest.source, source)
assert.equal(Object.keys(manifest.images).length, 6)
const names = [
  'baseline',
  'compile-error',
  'timeout',
  'building-exit',
  'after-switch',
  'sqlite-commit-exit',
  'api-restart',
  'static-restart',
  'corrupt-history',
  'http-unavailable',
  'recovery-fails',
  'enospc',
  'before-switch',
]
const faults = names.map((name) => {
  const file = `P6E-final-faults-${name}.json`
  const bytes = fs.readFileSync('docs/evidence/' + file)
  const report = JSON.parse(bytes)
  assert.equal(report.result, 'PASS', name)
  assert.equal(report.sourceRevision, source, name)
  return {
    case: name,
    file,
    sha256: hash(bytes),
    result: report.result,
    source: report.sourceRevision,
    jobId: report.jobId,
    originalActive: report.originalActive,
    checkpoints: report.events.map((event) => event.point),
    kernelFailure: report.kernelFailure,
    taskElapsedMilliseconds: report.taskElapsedMilliseconds,
    elapsedMilliseconds: report.elapsedMilliseconds,
    successDiagnosticCleared: report.successDiagnosticCleared,
    failureAuditEventsRetained: report.failureAuditEventsRetained,
    manualIntervention: report.manualIntervention,
  }
})
assert.equal(faults.find((v) => v.case === 'timeout').taskElapsedMilliseconds, 600000)
assert.equal(faults.find((v) => v.case === 'enospc').kernelFailure.afterAvailableBytes, 0)
assert.ok(faults.find((v) => v.case === 'recovery-fails').failureAuditEventsRetained >= 2)
assert.equal(faults.find((v) => v.case === 'recovery-fails').successDiagnosticCleared, true)
fs.writeFileSync(
  'docs/evidence/P6E-final-faults-summary.json',
  JSON.stringify({ date: new Date().toISOString(), source, result: 'PASS', faults }, null, 2) +
    '\n',
)
const evidence = [
  'P6E-final-admin-browser',
  'P6E-final-publishing-browser',
  'P6E-final-public-interactions',
  'P6E-final-backup-recovery',
  'P6E-cross-source-final',
  'P6E-cross-source-new-content',
  'P6E-cross-source-retention',
].map((name) => {
  const bytes = fs.readFileSync('docs/evidence/' + name + '.json')
  const value = JSON.parse(bytes)
  assert.equal(value.result, 'PASS', name)
  return {
    file: name + '.json',
    result: value.result,
    cases: value.cases?.length,
    sha256: hash(bytes),
  }
})
const repair = read('P6E-final-current-repair')
assert.equal(repair.result, 'FAIL')
assert.equal(read('P6E-final-current-readonly-probe').result, 'REPRODUCED_BLOCKER')
const runtimePaths = [
  'backend',
  'admin',
  'app',
  'shared',
  'server',
  'public',
  'deploy',
  'Dockerfile',
  'compose.admin-publish.yaml',
  'nuxt.config.ts',
  'package.json',
  'package-lock.json',
  'scripts/v11-release.mjs',
  'scripts/v11-release-probe.mjs',
  'scripts/v11-current-repair.mjs',
  'scripts/v11-maintenance.mjs',
]
assert.equal(git('diff', '--name-only', source, '--', ...runtimePaths), '')
const changes = git('diff', '--name-only', '7b17165111faeaa14b93b5b1f0f0e492868e27c8')
  .split('\n')
  .filter(Boolean)
const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
const files = [...new Set([...changes, ...untracked])].sort()
fs.writeFileSync(
  'docs/evidence/P6E-final-changed-files.json',
  JSON.stringify(
    { source, comparisonBase: '7b17165111faeaa14b93b5b1f0f0e492868e27c8', files },
    null,
    2,
  ) + '\n',
)
const goLines = fs
  .readFileSync('docs/evidence/P6E-final-group-go-tests.txt', 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.startsWith('{'))
  .map((line) => JSON.parse(line))
const report = {
  date: new Date().toISOString(),
  source,
  result: 'PARTIAL_BLOCKED_CURRENT_REPAIR',
  imageIds: Object.fromEntries(
    Object.entries(manifest.images).map(([key, value]) => [key, value.id]),
  ),
  evidence,
  blockingAcceptance: {
    file: 'P6E-final-current-repair.json',
    result: repair.result,
    diagnosis: 'P6E-final-current-readonly-probe.json',
    remaining:
      'Read-only plan, audited link repair, then post-repair backup/restore/update not passed on final images.',
  },
  go: {
    passedTestEvents: goLines.filter((x) => x.Action === 'pass' && x.Test).length,
    failedEvents: goLines.filter((x) => x.Action === 'fail').length,
    skippedTestEvents: goLines.filter((x) => x.Action === 'skip' && x.Test).length,
  },
  frozenRuntimePathsUnchanged: runtimePaths,
  productionTouched: false,
  productionPublishingEnabled: false,
  limitations: [
    'This summary does not replace raw requests, failure checkpoints, manual intervention or scanner findings.',
    'No production gate, deployment authorization, offsite backup or external notification service is established.',
    'Final-group Firefox/WebKit admin, Safari, physical mobile, penetration and host power-loss tests are not claimed.',
  ],
}
assert.equal(report.go.failedEvents, 0)
fs.writeFileSync(
  'docs/evidence/P6E-final-closure-summary.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log(report.result)
