// Operator-only V1.1 lifecycle. All subprocess arguments are arrays; no shell,
// SSH, GitHub credentials, arbitrary Compose file, script, or service is accepted.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claimLifecycleLock, chainOwner, assertNoRecovery } from './v11-operation.mjs'
import {
  enterSharedBarrier,
  completeSharedBarrier,
  controlPublish,
  provisionControl,
  sharedBarrierHeld,
} from './v11-barrier.mjs'
import {
  assertProjectImages,
  backupProject,
  docker,
  inspectProject,
  localEngine,
  projectName,
  tool,
  verifyBackup,
  volumeNames,
} from './v11-maintenance.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roles = ['api', 'worker', 'gateway', 'frontend', 'static', 'maintenance']
const imageID = /^sha256:[0-9a-f]{64}$/
const sourceID = /^[0-9a-f]{40}$/
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
function syncDirectory(directory) {
  // Windows does not expose fsync of directory handles through Node. The
  // existing operation.lock is still retained before any unsafe transition.
  if (process.platform === 'win32') return
  const descriptor = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.new`
  const descriptor = fs.openSync(temporary, 'wx', 0o600)
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  fs.renameSync(temporary, file)
  syncDirectory(path.dirname(file))
}
function validateSpec(spec) {
  assert.deepEqual(Object.keys(spec).sort(), ['format', 'images', 'schema', 'source'].sort())
  assert.equal(spec.format, 1)
  assert.match(spec.source, sourceID)
  assert.ok(Number.isSafeInteger(spec.schema) && spec.schema > 0)
  assert.deepEqual(Object.keys(spec.images).sort(), [...roles].sort())
  for (const role of roles) {
    assert.match(spec.images[role], imageID)
    assert.equal(
      docker(['image', 'inspect', '--format', '{{.Id}}', spec.images[role]]),
      spec.images[role],
    )
    assert.equal(
      docker([
        'image',
        'inspect',
        '--format',
        '{{index .Config.Labels "org.opencontainers.image.revision"}}',
        spec.images[role],
      ]),
      spec.source,
      `${role} source label must match the reviewed complete source SHA`,
    )
    // Retain a project-specific immutable tag before a development/build tag is
    // moved. Docker's containerd image store may otherwise discard an untagged
    // image record even though the operator did not run an image prune.
    docker([
      'tag',
      spec.images[role],
      `xiaowork-homepage-v11-retained:${role}-${spec.source.slice(0, 12)}-${spec.images[role].slice(7, 19)}`,
    ])
  }
  assert.equal(
    docker([
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
      spec.images.worker,
    ]),
    spec.source,
    'Worker source label must match the reviewed complete source SHA',
  )
  tool(spec.images.maintenance, 'compatible', [], ['-schema', String(spec.schema)])
  return spec
}
// Production (openresty) topology: host OpenResty reaches the gateway through a
// loopback-published port, so every connection arrives from the pinned edge
// bridge address. Only that edge /28 may assert the client address, and only
// via X-Real-IP, which 1Panel OpenResty overwrites with its own $remote_addr.
// Containers on the internal control/isolated networks are never trusted.
export function edgeSubnetFor(subnet) {
  assert.match(subnet, /^192\.168\.(?:2[0-4][0-9]|25[0-4])\.0\/28$/)
  return `${subnet.split('.').slice(0, 3).join('.')}.16/28`
}
export function gatewayRealIpConfig(edgeSubnet) {
  assert.match(edgeSubnet, /^192\.168\.(?:2[0-4][0-9]|25[0-4])\.16\/28$/)
  return [
    '# Generated per project. Trust X-Real-IP only from the pinned edge bridge.',
    `set_real_ip_from ${edgeSubnet};`,
    'real_ip_header X-Real-IP;',
    'real_ip_recursive off;',
    '',
  ].join('\n')
}
// Read-only presence check of the session key on first openresty deployment.
// Like every maintenance tool mount it must not populate the original volume.
export function secretStatusMount(project) {
  assert.match(project, /^xiaowork-homepage-v11-[a-z0-9-]{1,40}$/)
  return [
    '--mount',
    `type=volume,src=${project}_admin-secrets,dst=/source/secrets,readonly,volume-nocopy`,
  ]
}
export function configuration(
  project,
  spec,
  state,
  topology,
  httpPort,
  httpsPort,
  subnet,
  publish,
) {
  assert.ok(['simulation', 'openresty'].includes(topology))
  assert.ok(Number.isInteger(httpPort) && httpPort >= 1024 && httpPort <= 65535)
  assert.ok(Number.isInteger(httpsPort) && httpsPort >= 1024 && httpsPort <= 65535)
  assert.match(subnet, /^192\.168\.(?:2[0-4][0-9]|25[0-4])\.0\/28$/)
  const prefix = subnet.split('.').slice(0, 3).join('.')
  assert.equal(typeof publish, 'boolean')
  const mode = publishModeFor(topology, publish)
  const origin =
    topology === 'simulation' ? `https://localhost:${httpsPort}` : 'https://xiaoworks.com'
  const env = {
    XIAOWORK_ORIGIN: origin,
    XIAOWORK_TRUSTED_PROXY_CIDRS: `${prefix}.2/32`,
    XIAOWORK_LOCAL_PUBLISH: mode === 'local' ? '1' : '0',
    XIAOWORK_PUBLISH_MODE: mode,
    XIAOWORK_PROJECT: project,
    XIAOWORK_SOURCE_REVISION: spec.source,
    XIAOWORK_BUILDER_ID: spec.images.worker,
  }
  const services = {
    'control-init': { image: spec.images.maintenance },
    'publication-init': { image: spec.images.worker },
    'api-init': {
      image: spec.images.api,
      environment: { ...env, XIAOWORK_LOCAL_PUBLISH: '0', XIAOWORK_PUBLISH_MODE: 'off' },
      networks: { control: { ipv4_address: `${prefix}.4` } },
    },
    api: {
      image: spec.images.api,
      environment: env,
      networks: { control: { ipv4_address: `${prefix}.3` } },
    },
    worker: {
      image: spec.images.worker,
      command: [
        '-socket',
        '/run/publishing/publisher.sock',
        '-root',
        '/publications',
        '-source-revision',
        spec.source,
        '-builder-id',
        spec.images.worker,
      ],
    },
    frontend: { image: spec.images.frontend },
    'publication-static': {
      image: spec.images.static,
      networks: { control: { ipv4_address: `${prefix}.5` }, isolated: {} },
    },
    gateway: {
      image: spec.images.gateway,
      networks: { control: { ipv4_address: `${prefix}.2` }, isolated: {}, edge: {} },
    },
  }
  const networks = { control: { ipam: { config: [{ subnet }] } } }
  fs.mkdirSync(state, { recursive: true, mode: 0o700 })
  if (topology === 'openresty') {
    const edgeSubnet = edgeSubnetFor(subnet)
    networks.edge = { ipam: { config: [{ subnet: edgeSubnet }] } }
    // Bind-mounted single file read by the gateway's UID 10001: world-readable,
    // contains no secret (only the project's own edge CIDR).
    const realIp = path.join(state, 'gateway-realip.generated.conf')
    fs.writeFileSync(realIp, gatewayRealIpConfig(edgeSubnet))
    fs.chmodSync(realIp, 0o644)
    services['api-init'].command = ['migrate']
    services.gateway.volumes = [
      `${path.join(root, 'deploy/v11/gateway-openresty.conf').replaceAll('\\', '/')}:/etc/nginx/nginx.conf:ro`,
      `${path.join(root, 'deploy/v11/locations-openresty.conf').replaceAll('\\', '/')}:/etc/nginx/xiaowork-locations.conf:ro`,
      `${realIp.replaceAll('\\', '/')}:/etc/nginx/xiaowork-realip.conf:ro`,
    ]
  }
  const override = path.join(state, 'compose.generated.yaml')
  // JSON is YAML-compatible. !override is needed only for replacing host ports.
  const rendered = JSON.stringify({ services, networks }, null, 2)
  fs.writeFileSync(override, rendered, { mode: 0o600 })
  const ports = path.join(state, 'ports.generated.yaml')
  fs.writeFileSync(
    ports,
    `services:\n  gateway:\n    ports: !override\n      - '127.0.0.1:${httpPort}:8080'\n${topology === 'simulation' ? `      - '127.0.0.1:${httpsPort}:3445'\n` : ''}`,
    { mode: 0o600 },
  )
  return {
    project,
    topology,
    httpPort,
    httpsPort,
    subnet,
    publish,
    spec,
    files: [path.join(root, 'compose.admin-publish.yaml'), override, ports],
    env: {
      V11_SOURCE_REVISION: spec.source,
      V11_BUILDER_ID: spec.images.worker,
      V11_LOCAL_PUBLISH: mode === 'local' ? '1' : '0',
    },
  }
}
// Worker/publication machinery: simulation uses the loopback-only local gate;
// openresty uses production mode, which the API opens only with a valid
// operator authorization in the control volume. Only authorize-publishing may
// turn openresty publishing on; deploy/update/rollback never do.
export function publishModeFor(topology, publish) {
  assert.ok(['simulation', 'openresty'].includes(topology))
  if (!publish) return 'off'
  return topology === 'simulation' ? 'local' : 'production'
}
export function deployPublishFlag(topology, flag) {
  assert.ok(flag === undefined || flag === '0' || flag === '1', '--local-publish must be 0 or 1')
  assert.ok(
    !(flag === '1' && topology === 'openresty'),
    'Production publishing is enabled only by authorize-publishing after acceptance',
  )
  return flag === '1'
}
const notePattern = /^[^\r\n\0]{8,500}$/
// Lifecycle record of the last backup verified by this tool for this project.
export function lastBackupRecord(destination, spec, verifiedAt, contentManifestSHA256) {
  assert.ok(path.isAbsolute(destination))
  assert.match(contentManifestSHA256, /^[a-f0-9]{64}$/)
  return {
    format: 1,
    path: destination,
    contentManifestSHA256,
    verifiedAt,
    source: spec.source,
    maintenance: spec.images.maintenance,
  }
}
// Authorization requires a backup of THIS release identity verified within 24h.
export function assertFreshBackup(record, spec, now = Date.now()) {
  assert.equal(record.format, 1)
  assert.equal(record.source, spec.source, 'Latest verified backup belongs to another release')
  assert.equal(
    record.maintenance,
    spec.images.maintenance,
    'Latest verified backup was made by another maintenance image; take a new backup',
  )
  const age = now - Date.parse(record.verifiedAt)
  assert.ok(
    Number.isFinite(age) && age >= -5 * 60_000 && age <= 24 * 3600_000,
    'Production publishing authorization requires a backup verified within the last 24 hours',
  )
}
const composeArgs = (config) => [
  'compose',
  '-p',
  config.project,
  ...config.files.flatMap((file) => ['-f', file]),
  ...(config.publish ? ['--profile', 'publisher'] : []),
]
const compose = (config, args) =>
  docker([...composeArgs(config), ...args], { env: { ...process.env, ...config.env } })
// With publishing off (production default, and every candidate after an
// openresty update/rollback) the project must have no publisher container.
// A previously authorized release leaves its stopped worker behind; it would
// otherwise fail every later image-identity check (backup/update/rollback).
// Only a STOPPED worker is removed (stateless; data lives in volumes); a
// running one means writers were not stopped and the operation is refused.
export function removeStalePublisher(project) {
  projectName(project)
  const ids = docker([
    'ps',
    '-aq',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--filter',
    'label=com.docker.compose.service=worker',
  ])
    .split(/\s+/)
    .filter(Boolean)
  for (const id of ids) {
    assert.equal(
      docker(['inspect', '--format', '{{.State.Running}}', id]),
      'false',
      'A running publisher exists while publishing is disabled; stop writers first',
    )
    docker(['rm', id])
  }
  return ids.length
}
function start(config, first) {
  compose(config, ['config', '--quiet'])
  if (!config.publish) removeStalePublisher(config.project)
  compose(config, ['up', '-d', '--no-build', 'publication-init', 'api-init'])
  if (first && config.topology === 'openresty') {
    const secret = tool(
      config.spec.images.maintenance,
      'secret-status',
      secretStatusMount(config.project),
    )
    if (!secret.ready) compose(config, ['run', '--rm', '--no-deps', 'api-init', 'init-secret'])
  }
  compose(config, ['up', '-d', '--no-build', '--wait', '--wait-timeout', '120'])
  return JSON.parse(
    compose(config, ['ps', '--format', 'json'])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line)
      .join('\n')
      .startsWith('[')
      ? compose(config, ['ps', '--format', 'json'])
      : `[${compose(config, ['ps', '--format', 'json']).split(/\r?\n/).filter(Boolean).join(',')}]`,
  )
}
function stopWriters(config) {
  compose(config, ['stop', '--timeout', '40', 'worker', 'api', 'api-init'])
}
function publicProbe(config, backupDirectory) {
  const state = path.join(root, '.v11-deploy', config.project)
  const plan = {
    maintenance: sharedBarrierHeld(config.project),
    topology: config.topology,
    httpPort: config.httpPort,
    httpsPort: config.httpsPort,
  }
  if (config.topology === 'simulation') {
    plan.caFile = path.join(state, 'probe-ca.crt')
    const init = compose(config, ['ps', '-a', '-q', 'api-init'])
    assert.match(init, /^[a-f0-9]{12,64}$/)
    docker(['cp', `${init}:/authority/ca.crt`, plan.caFile])
  }
  if (backupDirectory) {
    const manifest = json(path.join(backupDirectory, 'content', 'manifest.json'))
    if (manifest.state.activeRelease) {
      assert.match(manifest.state.activeRelease, /^rel_[a-f0-9]{32}$/)
      plan.artifact = json(
        path.join(
          backupDirectory,
          'content',
          'publications',
          'releases',
          manifest.state.activeRelease,
          'manifest.json',
        ),
      )
    }
  }
  const file = path.join(state, 'probe-plan.json')
  fs.writeFileSync(file, JSON.stringify(plan), { mode: 0o600 })
  return JSON.parse(
    execFileSync(process.execPath, [path.join(root, 'scripts/v11-release-probe.mjs'), file], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
}
export function runLifecycle(input) {
  const args = [...input]
  const command = args.shift()
  let lifecycleOwner = randomUUID()
  let lock
  let barrierProject
  let operationAccepted = false
  // True only while a command is still checking preconditions and has changed
  // nothing; a refusal then releases its own fresh lock instead of retaining it.
  let releaseOnRefusal = false
  const options = {}
  while (args.length) {
    const key = args.shift()
    assert.match(key ?? '', /^--[a-z-]+$/)
    assert.ok(args.length && !args[0].startsWith('--'), `Missing value for ${key}`)
    assert.equal(options[key.slice(2)], undefined, `Duplicate ${key}`)
    options[key.slice(2)] = args.shift()
  }
  let inherited = false
  try {
    localEngine()
    if (command === 'attest') {
      const images = Object.fromEntries(
        roles.map((role) => [
          role,
          docker(['image', 'inspect', '--format', '{{.Id}}', options[role]]),
        ]),
      )
      const source = options.source
      assert.match(source ?? '', sourceID)
      execFileSync('git', ['cat-file', '-e', `${source}^{commit}`], { cwd: root, stdio: 'ignore' })
      const spec = validateSpec({
        format: 1,
        source,
        schema: Number(options.schema ?? '3'),
        images,
      })
      save(path.resolve(options.out), spec)
      console.log('Pinned local release descriptor written; operator review is still required.')
    } else {
      const project = projectName(options.project)
      const state = path.join(root, '.v11-deploy', project)
      fs.mkdirSync(state, { recursive: true, mode: 0o700 })
      if (command === 'revoke-publishing' || command === 'publishing-status') {
        // Emergency/observability path: never takes or needs the lifecycle lock,
        // so revocation works even while an unresolved recovery blocks others.
        const prior = json(path.join(state, 'current.json'))
        assert.equal(prior.project, project)
        assert.match(prior.spec?.images?.maintenance ?? '', imageID)
        const flags = []
        if (command === 'revoke-publishing') {
          assert.match(
            options.reason ?? '',
            /^[^\r\n\0]{4,500}$/,
            'A non-secret revocation reason (4-500 characters) is required',
          )
          flags.push('-note', options.reason)
        }
        const result = controlPublish(
          project,
          prior.spec.images.maintenance,
          command === 'revoke-publishing' ? 'revoke-publish' : 'publish-status',
          flags,
        )
        console.log(JSON.stringify(result, null, 2))
        return
      }
      const requestedLock = path.join(state, 'operation.lock')
      const parentOwner = chainOwner(project)
      inherited = Boolean(parentOwner)
      if (inherited) {
        lifecycleOwner = parentOwner
        assertNoRecovery(project, lifecycleOwner)
      } else {
        fs.mkdirSync(requestedLock, { mode: 0o700 })
        lock = requestedLock
        claimLifecycleLock(project, lifecycleOwner)
      }
      const currentFile = path.join(state, 'current.json')
      const previousFile = path.join(state, 'previous.json')
      assert.ok(
        inherited || !fs.existsSync(path.join(state, 'recovery-required.json')),
        'An unresolved update blocks subsequent operations; inspect the preserved recovery record',
      )
      if (command === 'deploy') {
        assert.ok(!fs.existsSync(currentFile), 'V1.1 deployment state already exists; use update')
        const spec = validateSpec(json(path.resolve(options.manifest)))
        const pendingFile = path.join(state, 'initializing.json')
        const resuming = fs.existsSync(pendingFile)
        if (resuming)
          assert.deepEqual(
            json(pendingFile).spec,
            spec,
            'Interrupted first deployment can resume only its exact original image/source descriptor',
          )
        const existing = docker([
          'ps',
          '-aq',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ])
        assert.ok(
          existing === '' || resuming,
          'Existing same-name containers require investigation before initial deployment',
        )
        const volumes = new Set(docker(['volume', 'ls', '--format', '{{.Name}}']).split(/\s+/))
        const present = Object.values(volumeNames(project)).some((name) => volumes.has(name))
        assert.ok(
          !present || options.restored === '1' || resuming,
          'Existing volumes cannot be adopted by first deployment without explicit independently restored-data mode',
        )
        const config = configuration(
          project,
          spec,
          state,
          options.topology ?? 'simulation',
          Number(options['http-port'] ?? 3216),
          Number(options['https-port'] ?? 3449),
          options.subnet ?? '192.168.245.0/28',
          deployPublishFlag(options.topology ?? 'simulation', options['local-publish']),
        )
        if (options.restored !== '1') provisionControl(project, spec.images.maintenance)
        enterSharedBarrier(project, spec.images.maintenance, lifecycleOwner)
        barrierProject = project
        if (present && !resuming)
          assert.equal(
            inspectProject(project, spec.images.maintenance, lifecycleOwner).schema,
            spec.schema,
          )
        if (resuming)
          assert.deepEqual(
            json(pendingFile).configuration,
            {
              topology: config.topology,
              httpPort: config.httpPort,
              httpsPort: config.httpsPort,
              subnet: config.subnet,
              publish: config.publish,
            },
            'Interrupted deployment topology must remain unchanged',
          )
        else
          save(pendingFile, {
            spec,
            configuration: {
              topology: config.topology,
              httpPort: config.httpPort,
              httpsPort: config.httpsPort,
              subnet: config.subnet,
              publish: config.publish,
            },
          })
        const containers = start(config, options.restored !== '1')
        const record = {
          ...config,
          env: undefined,
          createdAt: new Date().toISOString(),
          containers,
          http: publicProbe(config),
        }
        save(currentFile, record)
        fs.unlinkSync(pendingFile)
        console.log(JSON.stringify({ result: 'healthy', state: currentFile, http: record.http }))
        operationAccepted = true
      } else {
        assert.ok(fs.existsSync(currentFile), 'Initialize independent V1.1 deployment state first')
        const prior = json(currentFile)
        const current = configuration(
          project,
          validateSpec(prior.spec),
          state,
          prior.topology,
          prior.httpPort,
          prior.httpsPort,
          prior.subnet,
          prior.publish,
        )
        if (command === 'status') {
          console.log(compose(current, ['ps', '-a']))
          operationAccepted = true
          return
        }
        if (command === 'stop') {
          enterSharedBarrier(project, current.spec.images.maintenance, lifecycleOwner)
          barrierProject = project
          compose(current, ['down'])
          console.log('Only the selected V1.1 project stopped; all volumes and images retained.')
          operationAccepted = true
          return
        }
        if (command === 'authorize-publishing') {
          releaseOnRefusal = true
          assert.equal(
            prior.topology,
            'openresty',
            'Only the production (openresty) topology uses the operator publishing gate',
          )
          const note = options['approval-note']
          assert.match(
            note ?? '',
            notePattern,
            'A non-secret approval note (8-500 characters) is required',
          )
          const days = Number(options.days ?? '7')
          assert.ok(Number.isInteger(days) && days >= 1 && days <= 30, '--days must be 1-30')
          const spec = current.spec
          assertProjectImages(project, spec.images)
          const last = json(path.join(state, 'last-backup.json'))
          assertFreshBackup(last, spec)
          const verified = verifyBackup(spec.images.maintenance, last.path)
          assert.equal(verified.runtime.source, spec.source)
          assert.equal(
            json(path.join(last.path, 'bundle.json')).contentManifestSHA256,
            last.contentManifestSHA256,
            'Backup bundle changed since it was recorded',
          )
          // From here on state may change: any failure retains the lifecycle lock.
          releaseOnRefusal = false
          // Start the publication machinery FIRST: without an authorization the
          // API keeps the gate closed, so any failure here leaves publishing off.
          const next = configuration(
            project,
            spec,
            state,
            prior.topology,
            prior.httpPort,
            prior.httpsPort,
            prior.subnet,
            true,
          )
          const containers = start(next, false)
          const http = publicProbe(next)
          const gate = controlPublish(project, spec.images.maintenance, 'authorize-publish', [
            '-project',
            project,
            '-source',
            spec.source,
            '-schema',
            String(spec.schema),
            '-worker-image',
            spec.images.worker,
            '-api-image',
            spec.images.api,
            '-days',
            String(days),
            '-backup-path',
            last.path,
            '-backup-manifest-sha256',
            last.contentManifestSHA256,
            '-backup-verified-at',
            last.verifiedAt,
            '-note',
            note,
          ])
          assert.ok(gate.authorization && !gate.revocation && !gate.problem)
          const authorization = {
            id: gate.authorization.id,
            expiresAt: gate.authorization.expiresAt,
          }
          save(currentFile, {
            ...next,
            env: undefined,
            createdAt: prior.createdAt,
            containers,
            http,
            publishAuthorization: authorization,
          })
          console.log(
            JSON.stringify({ result: 'production publishing authorized', authorization, http }),
          )
          operationAccepted = true
          return
        }
        assert.ok(
          ['backup', 'update', 'rollback'].includes(command),
          'Expected attest|deploy|status|stop|backup|update|rollback|authorize-publishing|revoke-publishing|publishing-status',
        )
        const replacement =
          command === 'rollback'
            ? validateSpec(json(previousFile).spec)
            : command === 'update'
              ? validateSpec(json(path.resolve(options.manifest)))
              : null
        // Equality is deliberately conservative: no automatic schema upgrade or
        // destructive downgrade is permitted by this first lifecycle implementation.
        if (replacement)
          assert.equal(
            replacement.schema,
            current.spec.schema,
            'Cross-schema update/rollback requires a reviewed migration plan; automatic downgrade is forbidden',
          )
        enterSharedBarrier(project, current.spec.images.maintenance, lifecycleOwner)
        barrierProject = project
        stopWriters(current)
        let backup
        try {
          const db = inspectProject(project, current.spec.images.maintenance, lifecycleOwner)
          assert.equal(db.schema, current.spec.schema)
          let candidateBaseline
          if (replacement)
            tool(replacement.images.maintenance, 'compatible', [], ['-schema', String(db.schema)])
          if (replacement)
            candidateBaseline = inspectProject(
              project,
              replacement.images.maintenance,
              lifecycleOwner,
            )
          const destination = path.resolve(
            options.backup ?? path.join(root, '.cache', 'v11-backups', `${project}-${Date.now()}`),
          )
          backup = backupProject(
            project,
            current.spec.images.maintenance,
            destination,
            lifecycleOwner,
          )
          if (!replacement) {
            // Recorded only for a verified backup of the CURRENT release identity;
            // authorize-publishing requires it to be at most 24 hours old.
            save(
              path.join(state, 'last-backup.json'),
              lastBackupRecord(
                destination,
                current.spec,
                new Date().toISOString(),
                json(path.join(destination, 'bundle.json')).contentManifestSHA256,
              ),
            )
            start(current, false)
            console.log(
              JSON.stringify({
                result: 'backup verified',
                backup: destination,
                state: backup.state,
              }),
            )
            operationAccepted = true
            return
          }
          // A production authorization is bound to the replaced identity; the
          // candidate starts with publishing off until re-accepted and re-authorized.
          const next = configuration(
            project,
            replacement,
            state,
            current.topology,
            current.httpPort,
            current.httpsPort,
            current.subnet,
            current.topology === 'openresty' ? false : current.publish,
          )
          // Retain the already-created lock BEFORE attempting the durable intent.
          // ENOSPC, a failed stop, a metadata error, or process death must not make
          // an uncertain candidate eligible for another lifecycle operation.
          lock = undefined
          const recoveryFile = path.join(
            state,
            inherited ? 'chain-transition.json' : 'recovery-required.json',
          )
          save(recoveryFile, {
            owner: lifecycleOwner,
            at: new Date().toISOString(),
            phase: 'candidate-start-pending',
            reason: 'Candidate transition is not yet reconciled; subsequent operations are blocked',
            backup: destination,
            previous: current.spec,
            candidate: replacement,
          })
          const releaseGuard = () => {
            fs.unlinkSync(recoveryFile)
            syncDirectory(state)
            if (!inherited) lock = requestedLock
          }
          try {
            const containers = start(next, false)
            // A same-schema code transition is permitted only when both old and
            // new offline checkers accept the retained immutable content and all
            // recorded logical data remains unchanged. No schema migration or
            // cross-source content-rollback permission is inferred from this.
            stopWriters(next)
            const candidateState = inspectProject(
              project,
              next.spec.images.maintenance,
              lifecycleOwner,
            )
            assert.deepEqual(
              candidateState,
              candidateBaseline,
              'Candidate changed retained data during startup; automatic service acceptance is refused',
            )
            const priorReaderState = inspectProject(
              project,
              current.spec.images.maintenance,
              lifecycleOwner,
            )
            assert.deepEqual(
              priorReaderState,
              backup.state,
              'Prior checker cannot accept the retained data after candidate startup',
            )
            start(next, false)
            const http = publicProbe(next, destination)
            save(previousFile, prior)
            save(currentFile, {
              ...next,
              env: undefined,
              createdAt: new Date().toISOString(),
              containers,
              http,
              backup: destination,
            })
            releaseGuard()
            operationAccepted = true
            console.log(
              JSON.stringify({
                result: 'updated and verified',
                source: replacement.source,
                backup: destination,
                http,
              }),
            )
          } catch {
            // Do not automatically restore the old DB: the candidate may have
            // performed incompatible writes. Inspect using the old checker first.
            try {
              stopWriters(next)
              const observed = inspectProject(
                project,
                current.spec.images.maintenance,
                lifecycleOwner,
              )
              assert.equal(observed.schema, current.spec.schema)
              assert.deepEqual(
                observed,
                backup.state,
                'Candidate data differs from the pre-update backup; manual recovery is required',
              )
              if (candidateBaseline)
                assert.deepEqual(
                  inspectProject(project, next.spec.images.maintenance, lifecycleOwner),
                  candidateBaseline,
                  'Candidate logical data differs; manual recovery is required',
                )
              const old = configuration(
                project,
                current.spec,
                state,
                current.topology,
                current.httpPort,
                current.httpsPort,
                current.subnet,
                current.publish,
              )
              start(old, false)
              publicProbe(old, destination)
              // Saving the candidate metadata may have partially succeeded.
              // A recovered old service must also have the old current record.
              save(currentFile, prior)
              releaseGuard()
              throw Object.assign(
                new Error('Candidate failed; previous service restored and HTTP verified'),
                { safelyRestored: true },
              )
            } catch (recovery) {
              if (recovery.safelyRestored) throw recovery
              // Preserve the already-created atomic lock before attempting a
              // recovery record: ENOSPC must not accidentally unlock unsafe state.
              lock = undefined
              try {
                save(recoveryFile, {
                  owner: lifecycleOwner,
                  at: new Date().toISOString(),
                  phase: 'manual-recovery-required',
                  reason:
                    'Candidate failed; stopping writers or verifying the previous service did not complete',
                  backup: destination,
                  previous: current.spec,
                  candidate: replacement,
                })
              } catch {
                // The prior durable intent or, at minimum, operation.lock remains.
                // A full disk must never turn a failed recovery into an unlock.
              }
              throw new Error(
                'Manual recovery required; writer state is unconfirmed and the preserved operation lock blocks further updates',
                { cause: recovery },
              )
            }
          }
        } catch (failure) {
          if (!backup) {
            // If no candidate was started, the old immutable service is safe to
            // restart; an unfinished publication still needs its existing worker.
            start(current, false)
          }
          throw failure
        }
      }
    }
  } finally {
    // Only the command's own transient lock is released here. A parent chain
    // remains protected until its final acceptance, including HTTP checks.
    if (lock && !inherited && (operationAccepted || releaseOnRefusal)) {
      if (barrierProject) completeSharedBarrier(barrierProject, lifecycleOwner)
      fs.rmdirSync(lock)
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runLifecycle(process.argv.slice(2))
  } catch (error) {
    console.error('V1.1 lifecycle refused:', error.message)
    process.exitCode = 1
  }
}
