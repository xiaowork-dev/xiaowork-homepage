import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
export function docker(args, options = {}) {
  return execFileSync('docker', args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 360000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}
export function localEngine() {
  const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
  assert.ok(
    endpoint === 'npipe:////./pipe/dockerDesktopLinuxEngine' ||
      endpoint === 'unix:///var/run/docker.sock',
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
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/tmp:rw,size=32m,mode=1777',
  ]
}
export function tool(image, command, mounts, extra = []) {
  return JSON.parse(docker([...toolArgs(image), ...mounts, image, command, ...extra]))
}
function volumeMounts(project, root, writable) {
  return Object.entries(volumeNames(project)).flatMap(([role, name]) => [
    '--mount',
    `type=volume,src=${name},dst=${root}/${role}${writable ? '' : ',readonly'}`,
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
export function inspectProject(project, image) {
  assert.ok(
    ownedContainers(project).every(
      (c) => !c.running || !['api', 'worker', 'api-init'].includes(c.service),
    ),
    'Stop API, Worker and init writers before inspecting a coherent data set',
  )
  return tool(image, 'inspect', volumeMounts(project, '/source', true))
}
export function backupProject(project, image, destination) {
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
  assert.equal(
    inspectProject(project, image).unfinished,
    0,
    'Reconcile unfinished tasks before taking a planned offline backup',
  )
  const mount = [
    ...volumeMounts(project, '/source', true),
    '--mount',
    `type=bind,src=${path.dirname(absolute)},dst=/backup`,
  ]
  const manifest = tool(image, 'backup', mount, ['-target', `/backup/${path.basename(absolute)}`])
  const verified = verifyBackup(image, absolute)
  assert.deepEqual(verified.state, manifest.state)
  return manifest
}
export function verifyBackup(image, source) {
  const absolute = path.resolve(source)
  assert.ok(fs.statSync(absolute).isDirectory())
  return tool(
    image,
    'verify',
    ['--mount', `type=bind,src=${absolute},dst=/backup/set`],
    ['-source', '/backup/set'],
  )
}
export function restoreProject(project, image, source) {
  projectName(project)
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
  return tool(
    image,
    'restore',
    [
      ...volumeMounts(project, '/target', true),
      '--mount',
      `type=bind,src=${path.resolve(source)},dst=/backup/set`,
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
