import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNoRecovery, guardedOperation, chainOwner } from './v11-operation.mjs'
import { assertSharedBarrier, enterSharedBarrier, provisionControl } from './v11-barrier.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roles = ['db', 'uploads', 'publications', 'secrets', 'authority', 'tls']
const suffix = {
  db: 'admin-db',
  uploads: 'admin-uploads',
  publications: 'admin-publications',
  secrets: 'admin-secrets',
  authority: 'admin-authority',
  tls: 'admin-tls',
}
// Fixed non-root identity of the maintenance image (backend/maintenance.Dockerfile).
export const MAINTENANCE_UID = 10001
export const MAINTENANCE_GID = 10001
export function docker(args, options = {}) {
  return execFileSync('docker', args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 360000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}
// Ownership grants below are computed from this identity, so verify it on the
// exact image ID rather than trusting a constant alone.
export function assertMaintenanceIdentity(image) {
  assert.match(image, /^sha256:[a-f0-9]{64}$/)
  assert.equal(
    docker(['image', 'inspect', '--format', '{{.Config.User}}', image]),
    `${MAINTENANCE_UID}:${MAINTENANCE_GID}`,
    'Maintenance image must run as the reviewed fixed UID/GID 10001:10001',
  )
}
// Bind only the NEW backup directory itself, never its (operator-owned) parent.
// On native Linux a root-owned 0700 parent is not traversable by UID 10001.
export function backupMountPlan(absolute) {
  assert.ok(path.isAbsolute(absolute), 'Backup destination must be absolute')
  assert.ok(!/[,=]/.test(absolute), 'Backup destination must not contain mount separators')
  return { mount: ['--mount', `type=bind,src=${absolute},dst=/backup`], target: '/backup/content' }
}
// One-time ownership initialisation of brand-new, empty restore volumes. This is
// the only place populate (no volume-nocopy) is used, and never on source data.
export function restorePopulateMounts(project) {
  return Object.entries(volumeNames(project)).flatMap(([role, name]) => [
    '--mount',
    `type=volume,src=${name},dst=/target/${role}`,
  ])
}
export function localEngine() {
  const allowed = ['npipe:////./pipe/dockerDesktopLinuxEngine', 'unix:///var/run/docker.sock']
  assert.ok(
    !process.env.DOCKER_HOST || allowed.includes(process.env.DOCKER_HOST),
    'Only explicitly local DOCKER_HOST endpoints are supported; no Docker command was executed',
  )
  const context = process.env.DOCKER_CONTEXT
  assert.ok(
    !context || /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context),
    'Docker context selector is invalid',
  )
  const endpoint = docker([
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
    ...(context ? [context] : []),
  ])
  assert.ok(
    allowed.includes(endpoint),
    'Only the explicitly local Linux Docker engine is supported; SSH/TCP contexts are refused',
  )
}
export function projectName(name) {
  assert.match(name ?? '', /^xiaowork-homepage-v11-[a-z0-9-]{1,40}$/)
  return name
}
export function volumeNames(project) {
  projectName(project)
  return Object.fromEntries(roles.map((role) => [role, `${project}_${suffix[role]}`]))
}
function toolArgs(image) {
  assert.match(image, /^sha256:[a-f0-9]{64}$/)
  docker(['image', 'inspect', '--format', '{{.Id}}', image])
  return [
    'create',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    '512m',
    '--pids-limit',
    '64',
    '--tmpfs',
    '/tmp:rw,size=192m,mode=1777,nosuid,nodev,noexec',
  ]
}
export function tool(image, command, mounts, extra = []) {
  const id = docker([...toolArgs(image), ...mounts, image, command, ...extra])
  let accepted = false
  try {
    const actual = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', id]))
    const expected = mounts
      .filter((_, i) => i % 2 === 1)
      .map((value) =>
        Object.fromEntries(
          value.split(',').map((x) => (x.includes('=') ? x.split('=') : [x, true])),
        ),
      )
    assert.equal(actual.length, expected.length, 'Unexpected maintenance mount count')
    for (const mount of expected) {
      const found = actual.find((m) => m.Destination === mount.dst)
      assert.ok(found, 'Required maintenance mount absent')
      assert.equal(found.Type, mount.type)
      assert.equal(
        found.RW,
        !mount.readonly,
        'Maintenance mount access differs from requested scope',
      )
      assert.equal(
        mount.type === 'volume' ? found.Name : found.Source,
        mount.src,
        'Wrong source mounted',
      )
      if (mount.type === 'volume')
        assert.equal(mount['volume-nocopy'], true, 'Original volume populate must be disabled')
    }
    const output = docker(['start', '-a', id])
    assert.equal(
      docker(['inspect', '--format', '{{.State.ExitCode}}', id]),
      '0',
      'Maintenance exited nonzero',
    )
    const result = JSON.parse(output)
    accepted = true
    return result
  } finally {
    // Keep failed containers for read-only inspection; never force-remove one
    // that might still be accessing the source after a controller interruption.
    if (accepted) docker(['rm', id])
  }
}
function volumeMounts(project, root, writable) {
  return Object.entries(volumeNames(project)).flatMap(([role, name]) => [
    '--mount',
    `type=volume,src=${name},dst=${root}/${role},volume-nocopy${writable ? '' : ',readonly'}`,
  ])
}
function ownedContainers(project) {
  return docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
    .split(/\s+/)
    .filter(Boolean)
    .map((id) =>
      JSON.parse(
        docker([
          'inspect',
          '--format',
          '{"id":{{json .Id}},"running":{{json .State.Running}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}',
          id,
        ]),
      ),
    )
}
// Every existing container of the project must run exactly the recorded image
// of its role (init containers share the API/Worker images).
export function assertProjectImages(project, images) {
  const imageRoles = ['api', 'worker', 'gateway', 'frontend', 'static', 'maintenance']
  for (const role of imageRoles) assert.match(images[role] ?? '', /^sha256:[a-f0-9]{64}$/)
  for (const container of ownedContainers(project)) {
    const role =
      { 'api-init': 'api', 'publication-init': 'worker', 'publication-static': 'static' }[
        container.service
      ] ?? container.service
    if (!imageRoles.includes(role)) continue
    assert.equal(
      docker(['inspect', '--format', '{{.Image}}', container.id]),
      images[role],
      'Actual project image differs from recorded release descriptor',
    )
  }
}
export function inspectProject(project, image, lifecycleOwner) {
  lifecycleOwner ??= chainOwner(project)
  if (!lifecycleOwner)
    return guardedOperation(project, 'inspect', (context) => {
      enterSharedBarrier(project, image, context.owner)
      return inspectProject(project, image, context.owner)
    })
  assertNoRecovery(project, lifecycleOwner)
  assertSharedBarrier(project, image, lifecycleOwner)
  assert.ok(
    ownedContainers(project).every(
      (c) => !c.running || !['api', 'worker', 'api-init'].includes(c.service),
    ),
    'Stop API, Worker and init writers before inspecting a coherent data set',
  )
  return tool(image, 'inspect', volumeMounts(project, '/source', true))
}
export function backupProject(project, image, destination, lifecycleOwner) {
  lifecycleOwner ??= chainOwner(project)
  if (!lifecycleOwner)
    return guardedOperation(project, 'backup', (context) => {
      enterSharedBarrier(project, image, context.owner)
      return backupProject(project, image, destination, context.owner)
    })
  assertNoRecovery(project, lifecycleOwner)
  assertSharedBarrier(project, image, lifecycleOwner)
  projectName(project)
  const absolute = path.resolve(destination)
  assert.ok(!fs.existsSync(absolute), 'Backup destination must be new')
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') {
    execFileSync(
      'icacls',
      [path.dirname(absolute), '/inheritance:r', '/grant:r', `${os.userInfo().username}:(OI)(CI)F`],
      { stdio: 'ignore' },
    )
  } else {
    fs.chmodSync(path.dirname(absolute), 0o700)
  }
  const recorded = JSON.parse(
    fs.readFileSync(path.join(repository, '.v11-deploy', project, 'current.json'), 'utf8'),
  )
  assert.equal(recorded.project, project)
  assert.equal(recorded.spec.images.maintenance, image)
  const runtime = {
    format: 1,
    project,
    source: recorded.spec.source,
    schema: recorded.spec.schema,
    images: recorded.spec.images,
  }
  assert.match(runtime.source, /^[a-f0-9]{40}$/)
  const imageRoles = ['api', 'worker', 'gateway', 'frontend', 'static', 'maintenance']
  assert.deepEqual(Object.keys(runtime.images).sort(), [...imageRoles].sort())
  for (const role of imageRoles) assert.match(runtime.images[role], /^sha256:[a-f0-9]{64}$/)
  assertProjectImages(project, runtime.images)
  assert.equal(
    inspectProject(project, image, lifecycleOwner).unfinished,
    0,
    'Reconcile unfinished tasks before taking a planned offline backup',
  )
  const plan = backupMountPlan(absolute)
  const mount = [...volumeMounts(project, '/source', true), ...plan.mount]
  fs.mkdirSync(absolute, { mode: 0o700 })
  if (process.platform !== 'win32') {
    assertMaintenanceIdentity(image)
    // Grant only this new, empty 0700 directory to the non-root maintenance UID
    // so it can create content/; ownership returns to the operator afterwards.
    fs.chownSync(absolute, MAINTENANCE_UID, MAINTENANCE_GID)
  }
  const manifest = tool(image, 'backup', mount, ['-target', plan.target])
  if (process.platform !== 'win32') fs.chownSync(absolute, process.getuid(), process.getgid())
  const contentManifestSHA256 = createHash('sha256')
    .update(fs.readFileSync(path.join(absolute, 'content', 'manifest.json')))
    .digest('hex')
  fs.writeFileSync(
    path.join(absolute, 'bundle.json'),
    JSON.stringify(
      {
        format: 1,
        runtime,
        runtimeSHA256: createHash('sha256').update(JSON.stringify(runtime)).digest('hex'),
        contentManifestSHA256,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600, flag: 'wx' },
  )
  const verified = verifyBackup(image, absolute)
  assert.deepEqual(verified.state, manifest.state)
  return manifest
}
export function verifyBackup(image, source) {
  const absolute = path.resolve(source)
  assert.ok(fs.lstatSync(absolute).isDirectory() && !fs.lstatSync(absolute).isSymbolicLink())
  assert.deepEqual(fs.readdirSync(absolute).sort(), ['bundle.json', 'content'])
  for (const member of ['bundle.json', 'content'])
    assert.ok(!fs.lstatSync(path.join(absolute, member)).isSymbolicLink())
  const bundle = JSON.parse(fs.readFileSync(path.join(absolute, 'bundle.json'), 'utf8'))
  assert.deepEqual(
    Object.keys(bundle).sort(),
    ['contentManifestSHA256', 'format', 'runtime', 'runtimeSHA256'].sort(),
  )
  assert.equal(bundle.format, 1)
  assert.equal(bundle.runtime.format, 1)
  assert.equal(
    createHash('sha256').update(JSON.stringify(bundle.runtime)).digest('hex'),
    bundle.runtimeSHA256,
    'Runtime descriptor SHA mismatch',
  )
  assert.deepEqual(
    Object.keys(bundle.runtime).sort(),
    ['format', 'images', 'project', 'schema', 'source'].sort(),
  )
  projectName(bundle.runtime.project)
  assert.match(bundle.runtime.source, /^[a-f0-9]{40}$/)
  assert.deepEqual(Object.keys(bundle.runtime.images).sort(), [
    'api',
    'frontend',
    'gateway',
    'maintenance',
    'static',
    'worker',
  ])
  for (const identity of Object.values(bundle.runtime.images))
    assert.match(identity, /^sha256:[0-9a-f]{64}$/)
  assert.equal(
    image,
    bundle.runtime.images.maintenance,
    'Use the maintenance image recorded in the independent backup bundle',
  )
  assert.equal(
    createHash('sha256')
      .update(fs.readFileSync(path.join(absolute, 'content', 'manifest.json')))
      .digest('hex'),
    bundle.contentManifestSHA256,
    'Content manifest SHA does not match independent runtime bundle',
  )
  if (process.platform !== 'win32')
    assert.equal(
      fs.statSync(path.join(absolute, 'content')).uid,
      MAINTENANCE_UID,
      'Backup content must keep owner UID 10001 (copy with ownership preserved); permissions are never changed automatically',
    )
  const manifest = tool(
    image,
    'verify',
    ['--mount', `type=bind,src=${path.join(absolute, 'content')},dst=/backup/set,readonly`],
    ['-source', '/backup/set'],
  )
  assert.equal(manifest.state.schema, bundle.runtime.schema)
  return { ...manifest, runtime: bundle.runtime }
}
// Fresh `docker volume create` roots are root:root 0755 and volume-nocopy skips
// the image mount-point ownership, so UID 10001 could not write the restore.
// Creating (never starting) one container without nocopy copies the reviewed
// 10001:10001 0700 mount points into the just-created empty volumes only.
function populateRestoreTargets(project, image) {
  assertMaintenanceIdentity(image)
  const names = volumeNames(project)
  const id = docker([
    'create',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    ...restorePopulateMounts(project),
    image,
    'verify',
  ])
  try {
    const actual = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', id]))
    assert.equal(actual.length, Object.keys(names).length, 'Unexpected restore target mount count')
    for (const [role, name] of Object.entries(names)) {
      const found = actual.find((m) => m.Destination === `/target/${role}`)
      assert.ok(
        found && found.Type === 'volume' && found.Name === name && found.RW === true,
        'Restore target initialisation mounted an unexpected volume',
      )
    }
  } finally {
    // Never started: removing it cannot interrupt any data access.
    docker(['rm', id])
  }
  if (process.platform !== 'win32')
    for (const name of Object.values(names)) {
      const mountpoint = docker(['volume', 'inspect', '--format', '{{.Mountpoint}}', name])
      assert.equal(
        fs.statSync(mountpoint).uid,
        MAINTENANCE_UID,
        'New restore volume was not initialised for the maintenance UID',
      )
    }
}
export function restoreProject(project, image, source, lifecycleOwner) {
  lifecycleOwner ??= chainOwner(project)
  if (!lifecycleOwner)
    return guardedOperation(project, 'restore', (context) =>
      restoreProject(project, image, source, context.owner),
    )
  assertNoRecovery(project, lifecycleOwner)
  projectName(project)
  provisionControl(project, image)
  enterSharedBarrier(project, image, lifecycleOwner)
  assertSharedBarrier(project, image, lifecycleOwner)
  assert.equal(ownedContainers(project).length, 0, 'Recovery target must have no containers')
  const names = volumeNames(project)
  const existing = new Set(docker(['volume', 'ls', '--format', '{{.Name}}']).split(/\s+/))
  assert.ok(
    Object.values(names).every((name) => !existing.has(name)),
    'Recovery requires entirely new volume names; existing volumes are never overwritten',
  )
  verifyBackup(image, source)
  for (const name of Object.values(names)) {
    docker([
      'volume',
      'create',
      '--label',
      `com.docker.compose.project=${project}`,
      '--label',
      'io.xiaowork.v11.recovery=true',
      name,
    ])
  }
  populateRestoreTargets(project, image)
  return tool(
    image,
    'restore',
    [
      ...volumeMounts(project, '/target', true),
      '--mount',
      `type=bind,src=${path.resolve(source, 'content')},dst=/backup/set,readonly`,
    ],
    ['-source', '/backup/set', '-target', '/target'],
  )
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    localEngine()
    const [command, project, image, location] = process.argv.slice(2)
    const actions = {
      inspect: () => inspectProject(project, image),
      backup: () => backupProject(project, image, location),
      restore: () => restoreProject(project, image, location),
      verify: () => verifyBackup(image, location),
    }
    assert.ok(
      actions[command],
      'Usage: v11-maintenance.mjs inspect|backup|verify|restore PROJECT IMAGE_ID [NEW_BACKUP_DIRECTORY]',
    )
    console.log(JSON.stringify(actions[command](), null, 2))
  } catch (error) {
    console.error('V1.1 maintenance refused:', error.message)
    process.exitCode = 1
  }
}
