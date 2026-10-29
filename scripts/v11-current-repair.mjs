// Trusted offline operator CLI. This is never invoked by an HTTP endpoint.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { docker, localEngine, projectName, tool, volumeNames } from './v11-maintenance.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function currentRepair(command, project, image, member, plan, reason) {
  localEngine()
  projectName(project)
  assert.ok(['inspect', 'apply'].includes(command), 'Use inspect or apply')
  assert.match(image ?? '', /^sha256:[0-9a-f]{64}$/)
  const state = path.join(repository, '.v11-deploy', project)
  fs.mkdirSync(state, { recursive: true, mode: 0o700 })
  const lock = path.join(state, 'operation.lock')
  assert.ok(
    !fs.existsSync(path.join(state, 'recovery-required.json')),
    'Resolve code-update recovery before pointer repair',
  )
  fs.mkdirSync(lock, { mode: 0o700 })
  let safeToUnlock = true
  try {
    const containers = docker([
      'ps',
      '-aq',
      '--filter',
      `label=com.docker.compose.project=${project}`,
    ])
      .split(/\s+/)
      .filter(Boolean)
    for (const id of containers) {
      const info = JSON.parse(
        docker([
          'inspect',
          '--format',
          '{"running":{{json .State.Running}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}',
          id,
        ]),
      )
      assert.ok(
        !info.running || !['api', 'worker', 'api-init', 'publication-init'].includes(info.service),
        'Stop every project API, Worker and init writer; the tool does not stop services for you',
      )
    }
    const names = volumeNames(project)
    const existing = new Set(docker(['volume', 'ls', '--format', '{{.Name}}']).split(/\s+/))
    for (const name of Object.values(names))
      assert.ok(existing.has(name), 'Refuse implicit creation of missing data volumes')
    // Compose labels alone do not prove quiescence: another local container
    // may have been given one of these volumes. Never stop it implicitly.
    const running = docker(['ps', '-q']).split(/\s+/).filter(Boolean)
    for (const id of running) {
      const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', id]))
      assert.ok(
        !mounts.some((m) => Object.values(names).includes(m.Name) && m.RW),
        'A running container has writable access to this project data; stop and investigate it first',
      )
    }
    const mounts = Object.entries(names).flatMap(([role, name]) => [
      '--mount',
      `type=volume,src=${name},dst=/source/${role}${command === 'apply' && role === 'publications' ? '' : ',readonly'}`,
    ])
    const args =
      command === 'inspect' ? [] : ['-member', member, '-plan-sha256', plan, '-reason', reason]
    // A failed read may mean an incoherent source, not merely an absent schema.
    // Retain the shared guard until an operator has reviewed the original set.
    safeToUnlock = false
    fs.writeFileSync(
      path.join(lock, 'inspection.json'),
      JSON.stringify({ format: 1, project, image, command, startedAt: new Date().toISOString() }) +
        '\n',
      { flag: 'wx', mode: 0o600 },
    )
    const result = tool(
      image,
      command === 'inspect' ? 'inspect-current' : 'repair-current',
      mounts,
      args,
    )
    safeToUnlock = true
    return result
  } finally {
    // An indeterminate mutation retains the shared host guard for operator audit.
    if (safeToUnlock) {
      const receipt = path.join(lock, 'inspection.json')
      if (fs.existsSync(receipt)) fs.unlinkSync(receipt)
      fs.rmdirSync(lock)
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, project, image, member, plan, reason] = process.argv.slice(2)
    console.log(
      JSON.stringify(currentRepair(command, project, image, member, plan, reason), null, 2),
    )
  } catch (error) {
    console.error('V1.1 current repair refused:', error.message)
    process.exitCode = 1
  }
}
