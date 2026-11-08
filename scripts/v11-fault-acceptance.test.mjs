import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { CASES, parseArgs } from './v11-fault-acceptance.mjs'

test('fault harness only targets dedicated ft projects and fixed cases', () => {
  const ok = parseArgs([
    'all',
    '--project',
    'xiaowork-homepage-v11-ft-sim',
    '--secret',
    's',
    '--out',
    'o',
  ])
  assert.deepEqual(ok.cases, CASES)
  assert.equal(
    parseArgs(['timeout', '--project', 'xiaowork-homepage-v11-ft', '--secret', 's', '--out', 'o'])
      .cases[0],
    'timeout',
  )
  for (const project of ['xiaowork-homepage-v11-fin5', 'xiaowork-homepage', 'other'])
    assert.throws(() =>
      parseArgs(['baseline', '--project', project, '--secret', 's', '--out', 'o']),
    )
  assert.throws(() =>
    parseArgs(['rm-rf', '--project', 'xiaowork-homepage-v11-ft', '--secret', 's', '--out', 'o']),
  )
  assert.throws(() =>
    parseArgs(['baseline', '--project', 'xiaowork-homepage-v11-ft', '--cmd', 'x']),
  )
  assert.deepEqual(
    parseArgs([
      'api-restart,before-switch',
      '--project',
      'xiaowork-homepage-v11-ft',
      '--secret',
      's',
      '--out',
      'o',
    ]).cases,
    ['api-restart', 'before-switch'],
  )
  assert.throws(() =>
    parseArgs([
      'api-restart,evil',
      '--project',
      'xiaowork-homepage-v11-ft',
      '--secret',
      's',
      '--out',
      'o',
    ]),
  )
  assert.equal(CASES.at(-1), 'before-switch', 'the case leaving a current.next link runs last')
})

test('test-only images are isolated from production Dockerfiles', () => {
  const fixture = fs.readFileSync('scripts/fixtures/v11-fault-images.Dockerfile', 'utf8')
  assert.match(fixture, /-tags=p6e_fault/)
  assert.match(fixture, /io\.xiaowork\.test-only="fault-injection"/)
  for (const file of [
    'backend/Dockerfile',
    'backend/worker.Dockerfile',
    'backend/maintenance.Dockerfile',
    'admin/Dockerfile',
    'Dockerfile',
    'deploy/admin-publish/static.Dockerfile',
  ]) {
    const text = fs.readFileSync(file, 'utf8')
    assert.ok(!/p6e_fault|fault-images|test-only/.test(text), file)
  }
})
