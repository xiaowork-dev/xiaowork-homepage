// Trusted Docker adapter for the shared Linux maintenance protocol. No bind
// paths or public endpoints; only an exact project control volume is accepted.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const owners = new Map()
const run = (args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 750000 }).trim()
function localEndpoint() {
  assert.ok(
    !process.env.DOCKER_HOST ||
      ['unix:///var/run/docker.sock', 'npipe:////./pipe/dockerDesktopLinuxEngine'].includes(
        process.env.DOCKER_HOST,
      ),
  )
  if (process.env.DOCKER_CONTEXT)
    assert.match(process.env.DOCKER_CONTEXT, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
  const endpoint = run([
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
    ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []),
  ])
  assert.ok(
    ['unix:///var/run/docker.sock', 'npipe:////./pipe/dockerDesktopLinuxEngine'].includes(endpoint),
  )
}
function validate(project, image) {
  assert.match(project, /^xiaowork-homepage-v11-[a-z0-9-]{1,40}$/)
  assert.match(image, /^sha256:[a-f0-9]{64}$/)
  localEndpoint()
  const volume = project + '_admin-maintenance-control'
  const metadata = JSON.parse(run(['volume', 'inspect', volume]))[0]
  assert.equal(metadata.Driver, 'local')
  assert.equal(metadata.Labels?.['com.docker.compose.project'], project)
  assert.equal(metadata.Labels?.['com.docker.compose.volume'], 'admin-maintenance-control')
  assert.ok(
    !metadata.Options || Object.keys(metadata.Options).length === 0,
    'Custom volume drivers/mounts require review',
  )
  for (const id of run(['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`])
    .split(/\s+/)
    .filter(Boolean)) {
    const c = JSON.parse(run(['inspect', id]))[0]
    if (!['api', 'worker'].includes(c.Config.Labels?.['com.docker.compose.service'])) continue
    const m = c.Mounts.find((m) => m.Destination === '/control')
    assert.ok(
      m && m.Type === 'volume' && m.Name === volume && !m.RW,
      'Runtime participant has no verified read-only common control mount',
    )
  }
  return volume
}
function command(project, image, action, owner, populate = false) {
  const volume = validate(project, image)
  return JSON.parse(
    run([
      'run',
      '--rm',
      '--network',
      'none',
      '--read-only',
      '--user',
      '10001:10001',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--memory',
      '64m',
      '--pids-limit',
      '32',
      '--entrypoint',
      '/homepage-control',
      '--mount',
      `type=volume,src=${volume},dst=/control${populate ? '' : ',volume-nocopy'}`,
      image,
      '-owner',
      owner,
      action,
    ]),
  )
}
export function provisionControl(project, image) {
  assert.match(project, /^xiaowork-homepage-v11-[a-z0-9-]{1,40}$/)
  assert.match(image, /^sha256:[a-f0-9]{64}$/)
  localEndpoint()
  const volume = project + '_admin-maintenance-control'
  assert.ok(
    !run(['volume', 'ls', '--format', '{{.Name}}']).split(/\s+/).includes(volume),
    'Existing control state must never be initialized again',
  )
  run([
    'volume',
    'create',
    '--label',
    `com.docker.compose.project=${project}`,
    '--label',
    'com.docker.compose.volume=admin-maintenance-control',
    volume,
  ])
  command(project, image, 'init', '', true)
}
export function enterSharedBarrier(project, image, owner) {
  assert.match(owner, /^[a-f0-9-]{36}$/)
  const existing = owners.get(project)
  if (existing) {
    assert.equal(existing.owner, owner)
    assertSharedBarrier(project, image, owner)
    return
  }
  // Register before begin: even timeout/death cannot be treated as completion.
  owners.set(project, { image, owner, drained: false })
  const state = command(project, image, 'begin', owner)
  assert.deepEqual(state, { format: 1, mode: 'recovery-required', phase: 'drained', owner })
  owners.get(project).drained = true
}
export function assertSharedBarrier(project, image, owner) {
  const held = owners.get(project)
  assert.ok(
    held?.drained && held.owner === owner,
    'A drained shared maintenance barrier is required',
  )
  const state = command(project, image, 'status', owner)
  assert.deepEqual(state, { format: 1, mode: 'recovery-required', phase: 'drained', owner })
}
export function completeSharedBarrier(project, owner) {
  const held = owners.get(project)
  if (!held) return
  assertSharedBarrier(project, held.image, owner)
  const state = command(project, held.image, 'complete', owner)
  assert.deepEqual(state, { format: 1, mode: 'ready', phase: 'idle', owner: '' })
  owners.delete(project)
}
export const sharedBarrierHeld = (project) => owners.get(project)?.drained === true

// Production publishing authorization records are written ONLY here, by the
// maintenance image's homepage-control into the project control volume, which
// API and Worker mount read-only. Every flag value is pattern-checked.
const imageRe = /^sha256:[a-f0-9]{64}$/
export const publishFlagPatterns = new Map([
  ['-project', /^xiaowork-homepage-v11-[a-z0-9-]{1,40}$/],
  ['-source', /^[a-f0-9]{40}$/],
  ['-schema', /^[1-9][0-9]{0,3}$/],
  ['-worker-image', imageRe],
  ['-api-image', imageRe],
  ['-days', /^(?:[1-9]|[12][0-9]|30)$/],
  ['-backup-path', /^\/[^\r\n\0]{1,511}$/],
  ['-backup-manifest-sha256', /^[a-f0-9]{64}$/],
  ['-backup-verified-at', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/],
  ['-note', /^[^\r\n\0]{4,500}$/],
])
export function publishControlArgs(volume, image, action, flags = []) {
  assert.ok(['authorize-publish', 'revoke-publish', 'publish-status'].includes(action))
  assert.match(image, imageRe)
  assert.ok(flags.length % 2 === 0)
  const seen = new Set()
  for (let i = 0; i < flags.length; i += 2) {
    const pattern = publishFlagPatterns.get(flags[i])
    assert.ok(pattern && !seen.has(flags[i]), `Unexpected publishing control flag ${flags[i]}`)
    assert.match(String(flags[i + 1]), pattern, `Invalid value for ${flags[i]}`)
    seen.add(flags[i])
  }
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--user',
    '10001:10001',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    '64m',
    '--pids-limit',
    '32',
    '--entrypoint',
    '/homepage-control',
    '--mount',
    `type=volume,src=${volume},dst=/control,volume-nocopy`,
    image,
    ...flags,
    action,
  ]
}
export function controlPublish(project, image, action, flags = []) {
  const volume = validate(project, image)
  return JSON.parse(run(publishControlArgs(volume, image, action, flags)))
}
