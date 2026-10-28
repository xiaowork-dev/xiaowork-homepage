// Read-only baseline/comparison of containers outside the final isolated projects.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { localEngine } from './v11-maintenance.mjs'

const mode = process.argv[2]
assert.ok(['before', 'after'].includes(mode))
localEngine()
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim()
const ids = docker(['ps', '-aq']).split(/\s+/).filter(Boolean)
const containers = ids
  .map((id) => {
    const value = JSON.parse(docker(['inspect', id]))[0]
    return {
      id: value.Id,
      name: value.Name,
      image: value.Image,
      running: value.State.Running,
      startedAt: value.State.StartedAt,
      project: value.Config.Labels?.['com.docker.compose.project'] ?? '',
    }
  })
  .filter(
    (value) =>
      !value.project.startsWith('xiaowork-homepage-v11-p6e-closure-') &&
      !value.name.startsWith('/xiaowork-homepage-final-audit-'),
  )
const report = {
  date: new Date().toISOString(),
  scope:
    'Read-only local containers outside xiaowork-homepage-v11-p6e-closure-*; no environments or secrets recorded',
  containers,
}
if (mode === 'after') {
  const before = JSON.parse(
    readFileSync('docs/evidence/P6E-final-other-containers-before.json', 'utf8'),
  )
  report.checks = before.containers.map((expected) => {
    const observed = containers.find((value) => value.id === expected.id)
    return {
      id: expected.id,
      name: expected.name,
      unchanged: JSON.stringify(observed) === JSON.stringify(expected),
    }
  })
  report.result = report.checks.every((value) => value.unchanged)
    ? 'PASS_EXISTING_CONTAINERS_UNCHANGED'
    : 'DIFFERENCES_REQUIRE_REVIEW'
}
writeFileSync(
  `docs/evidence/P6E-final-other-containers-${mode}.json`,
  JSON.stringify(report, null, 2) + '\n',
)
console.log(JSON.stringify({ mode, containers: containers.length, result: report.result }))
