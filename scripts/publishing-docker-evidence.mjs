// Read-only evidence for the exact P6-D local acceptance project. This script
// never starts/stops/execs containers and never reads Env, commands or secrets.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const project = 'xiaowork-homepage-v11-p6d-e2e'
const services = [
  'api',
  'api-init',
  'worker',
  'publication-init',
  'publication-static',
  'gateway',
  'frontend',
]
const volumes = [
  'admin-db',
  'admin-uploads',
  'admin-secrets',
  'admin-authority',
  'admin-tls',
  'admin-publications',
  'admin-publisher-socket',
]
const expectedSource = process.argv[2]
const destination = path.resolve('docs/evidence/P6D-docker.json')
const report = {
  date: new Date().toISOString(),
  project,
  scope: 'Read-only local Docker inspection; no container or volume mutations',
  privateConfigurationRead: false,
  expectedSource,
  containers: [],
  volumes: [],
  checks: [],
  otherContainers: [],
  limitations: [
    'Other services are compared by existing ID, image, start time and running state; their HTTP functionality is not tested.',
    'Browser persistence is referenced only from its actual report; inspection alone does not prove data recovery.',
  ],
}
const cli = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const template = `{"id":{{json .Id}},"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"imageId":{{json .Image}},"state":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},"exitCode":{{json .State.ExitCode}},"restartCount":{{json .RestartCount}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"user":{{json .Config.User}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"capDrop":{{json .HostConfig.CapDrop}},"securityOpt":{{json .HostConfig.SecurityOpt}},"networkMode":{{json .HostConfig.NetworkMode}},"networks":[{{$first := true}}{{range $name,$v := .NetworkSettings.Networks}}{{if not $first}},{{end}}{{json $name}}{{$first = false}}{{end}}],"ports":{{json .HostConfig.PortBindings}},"mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}{"type":{{json $m.Type}},"volume":{{json $m.Name}},"destination":{{json $m.Destination}},"readWrite":{{json $m.RW}}}{{end}}],"memory":{{json .HostConfig.Memory}},"nanoCpus":{{json .HostConfig.NanoCpus}},"pidsLimit":{{json .HostConfig.PidsLimit}},"tmpfs":{{json .HostConfig.Tmpfs}},"logType":{{json .HostConfig.LogConfig.Type}},"logMaxSize":{{json (index .HostConfig.LogConfig.Config "max-size")}},"logMaxFile":{{json (index .HostConfig.LogConfig.Config "max-file")}}`
const identityTemplate =
  '{"id":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},"startedAt":{{json .State.StartedAt}},"state":{{json .State.Status}}}'
function check(name, condition) {
  assert.ok(condition, name)
  report.checks.push({ name, result: 'PASS' })
}
const mount = (container, target) => container.mounts.find((item) => item.destination === target)

try {
  assert.match(
    expectedSource ?? '',
    /^[a-f0-9]{40}$/,
    'Supply the reviewed full runtime source SHA as the sole argument',
  )
  check(
    'local Docker Desktop Linux Engine',
    cli('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}') ===
      'npipe:////./pipe/dockerDesktopLinuxEngine',
  )
  const ids = cli('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`)
    .split(/\r?\n/)
    .filter(Boolean)
  for (const id of ids) {
    assert.match(id, /^[a-f0-9]{12,64}$/)
    const membership = cli(
      'inspect',
      '--format',
      '{{index .Config.Labels "com.docker.compose.service"}}',
      id,
    )
    check('service belongs to fixed whitelist: ' + membership, services.includes(membership))
    const container = JSON.parse(cli('inspect', '--format', template, id))
    check(
      'exact project ownership: ' + membership,
      container.project === project && container.service === membership,
    )
    report.containers.push(container)
  }
  check(
    'exactly seven isolated services',
    report.containers.length === services.length &&
      new Set(report.containers.map((item) => item.service)).size === services.length,
  )
  for (const service of services) {
    const container = report.containers.find((item) => item.service === service)
    check(
      'non-root and read-only: ' + service,
      container.readOnly &&
        !container.privileged &&
        !!container.user &&
        !/^(?:root|0)(?::|$)/.test(container.user),
    )
    check(
      'drop ALL and no-new-privileges: ' + service,
      container.capDrop?.includes('ALL') &&
        container.securityOpt?.some((item) => item.startsWith('no-new-privileges')),
    )
    check(
      'bounded JSON logs: ' + service,
      container.logType === 'json-file' &&
        container.logMaxSize === '10m' &&
        container.logMaxFile === '3',
    )
    check(
      'no privileged socket/SSH/home mount: ' + service,
      container.mounts.every(
        (item) =>
          !/docker\.sock|docker_engine|\.ssh|^\/(?:root|home)(?:\/|$)/i.test(item.destination),
      ),
    )
    check(
      'only dedicated named volumes: ' + service,
      container.mounts
        .filter((item) => item.type === 'volume')
        .every((item) => volumes.some((name) => item.volume === project + '_' + name)),
    )
    if (service.endsWith('-init'))
      check(
        'initialization exited successfully: ' + service,
        container.state === 'exited' && container.exitCode === 0,
      )
    else
      check(
        'healthy service: ' + service,
        container.state === 'running' && container.health === 'healthy',
      )
    if (service !== 'gateway')
      check('no host port mapping: ' + service, Object.keys(container.ports ?? {}).length === 0)
  }
  const byName = Object.fromEntries(report.containers.map((item) => [item.service, item]))
  const bindings = Object.entries(byName.gateway.ports ?? {}).flatMap(([internal, entries]) =>
    entries.map((entry) => ({ internal, ...entry })),
  )
  const allowedPorts = { '8080/tcp': '3212', '3445/tcp': '3445', '9323/tcp': '9323' }
  check(
    'gateway only expected IPv4 loopback ports',
    bindings.length >= 2 &&
      bindings.every(
        (item) => item.HostIp === '127.0.0.1' && allowedPorts[item.internal] === item.HostPort,
      ),
  )
  check(
    'required gateway visitor/HTTPS bindings',
    ['8080/tcp', '3445/tcp'].every((port) => bindings.some((item) => item.internal === port)),
  )
  check(
    'offline worker and publication initializer',
    byName.worker.networkMode === 'none' && byName['publication-init'].networkMode === 'none',
  )
  check(
    'worker resource limits',
    byName.worker.memory === 3 * 1024 ** 3 &&
      byName.worker.nanoCpus === 2e9 &&
      byName.worker.pidsLimit === 256 &&
      !!byName.worker.tmpfs['/work'] &&
      !!byName.worker.tmpfs['/tmp'],
  )
  check(
    'worker volume isolation',
    byName.worker.mounts.length === 3 &&
      mount(byName.worker, '/publications')?.readWrite === true &&
      mount(byName.worker, '/uploads')?.readWrite === false &&
      mount(byName.worker, '/run/publishing')?.readWrite === true,
  )
  check(
    'API/static read-only publication volume',
    mount(byName.api, '/publications')?.readWrite === false &&
      mount(byName['publication-static'], '/publications')?.readWrite === false,
  )
  check(
    'runtime API has no CA private-key volume',
    !mount(byName.api, '/authority') &&
      !mount(byName.api, '/tls') &&
      mount(byName.api, '/secrets')?.readWrite === false,
  )
  check(
    'gateway TLS read-only and no account/DB volumes',
    mount(byName.gateway, '/tls')?.readWrite === false &&
      byName.gateway.mounts.every((item) => item.type !== 'volume' || item.destination === '/tls'),
  )
  check(
    'API confined to control network',
    byName.api.networks.length === 1 && byName.api.networks[0] === project + '_control',
  )
  const imageProof = JSON.parse(
    cli(
      'image',
      'inspect',
      '--format',
      '{"id":{{json .Id}},"sourceSHA":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}',
      byName.worker.imageId,
    ),
  )
  report.workerImage = imageProof
  check(
    'worker immutable image/source identity',
    imageProof.id === byName.worker.imageId && imageProof.sourceSHA === expectedSource,
  )
  for (const suffix of volumes) {
    const name = project + '_' + suffix
    const owner = cli(
      'volume',
      'inspect',
      '--format',
      '{{index .Labels "com.docker.compose.project"}}',
      name,
    )
    check('dedicated persisted volume: ' + suffix, owner === project)
    report.volumes.push({ name, project: owner })
  }
  const baselinePath = path.resolve('.cache/p6d-other-containers-before.txt')
  const baseline = (await readFile(baselinePath, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [id, name, imageId, startedAt, state] = line.trim().split(/\s+/)
      assert.match(id, /^[a-f0-9]{64}$/)
      assert.match(imageId, /^sha256:[a-f0-9]{64}$/)
      assert.equal(state, 'running')
      return { id, name, imageId, startedAt, state }
    })
  check('exact eleven-container pre-existing baseline', baseline.length === 11)
  for (const expected of baseline) {
    const actual = JSON.parse(cli('inspect', '--format', identityTemplate, expected.id))
    const unchanged = JSON.stringify(actual) === JSON.stringify(expected)
    report.otherContainers.push({ ...actual, unchanged })
    check('pre-existing identity/start/state unchanged: ' + expected.name, unchanged)
  }
  try {
    const browser = JSON.parse(
      await readFile(path.resolve('docs/evidence/P6D-browser.json'), 'utf8'),
    )
    report.browserPersistence = {
      evidence: 'P6D-browser.json',
      browserResult: browser.result,
      verified: browser.result === 'PASS' && browser.persistence?.result === 'PASS',
      ...(browser.persistence
        ? {
            result: browser.persistence.result,
            draftRevision: browser.persistence.draftRevision,
            activeReleaseId: browser.persistence.activeReleaseId,
          }
        : {}),
    }
  } catch {
    report.browserPersistence = {
      verified: false,
      reason: 'No readable browser result; not claimed by Docker inspection',
    }
  }
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  // Docker stderr and full tool errors can contain unrelated metadata. Persist
  // only our own assertion label or a fixed description for transport failures.
  report.failure =
    error?.code === 'ERR_ASSERTION'
      ? String(error.message)
      : 'Read-only Docker evidence collection failed; inspect the named local project separately.'
  process.exitCode = 1
} finally {
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n')
  console.log(
    `P6D Docker evidence ${report.result}: docs/evidence/P6D-docker.json; no environment or secret values collected.`,
  )
}
