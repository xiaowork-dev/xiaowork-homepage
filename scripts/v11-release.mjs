// Operator-only V1.1 lifecycle. All subprocess arguments are arrays; no shell,
// SSH, GitHub credentials, arbitrary Compose file, script, or service is accepted.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  backupProject,
  docker,
  inspectProject,
  localEngine,
  projectName,
  tool,
  volumeNames,
} from './v11-maintenance.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roles = ['api', 'worker', 'gateway', 'frontend', 'static', 'maintenance']
const imageID = /^sha256:[0-9a-f]{64}$/
const sourceID = /^[0-9a-f]{40}$/
const args = process.argv.slice(2)
const command = args.shift()
let lock
process.on('exit', () => {
  if (lock) {
    try {
      fs.rmdirSync(lock)
    } catch {
      /* Preserve uncertain state for operator review. */
    }
  }
})
const options = {}
while (args.length) {
  const key = args.shift()
  assert.match(key ?? '', /^--[a-z-]+$/)
  assert.ok(args.length && !args[0].startsWith('--'), `Missing value for ${key}`)
  assert.equal(options[key.slice(2)], undefined, `Duplicate ${key}`)
  options[key.slice(2)] = args.shift()
}
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.new`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  fs.renameSync(temporary, file)
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
function configuration(project, spec, state, topology, httpPort, httpsPort, subnet, publish) {
  assert.ok(['simulation', 'openresty'].includes(topology))
  assert.ok(Number.isInteger(httpPort) && httpPort >= 1024 && httpPort <= 65535)
  assert.ok(Number.isInteger(httpsPort) && httpsPort >= 1024 && httpsPort <= 65535)
  assert.match(subnet, /^192\.168\.(?:2[0-4][0-9]|25[0-4])\.0\/28$/)
  const prefix = subnet.split('.').slice(0, 3).join('.')
  assert.ok(!publish || topology === 'simulation', 'Production publishing remains hard-disabled')
  const origin =
    topology === 'simulation' ? `https://localhost:${httpsPort}` : 'https://xiaoworks.com'
  const env = {
    XIAOWORK_ORIGIN: origin,
    XIAOWORK_TRUSTED_PROXY_CIDRS: `${prefix}.2/32`,
    XIAOWORK_LOCAL_PUBLISH: publish ? '1' : '0',
    XIAOWORK_SOURCE_REVISION: spec.source,
    XIAOWORK_BUILDER_ID: spec.images.worker,
  }
  const services = {
    'publication-init': { image: spec.images.worker },
    'api-init': {
      image: spec.images.api,
      environment: { ...env, XIAOWORK_LOCAL_PUBLISH: '0' },
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
  if (topology === 'openresty') {
    services['api-init'].command = ['migrate']
    services.gateway.volumes = [
      `${path.join(root, 'deploy/v11/gateway-openresty.conf').replaceAll('\\', '/')}:/etc/nginx/nginx.conf:ro`,
      `${path.join(root, 'deploy/v11/locations-openresty.conf').replaceAll('\\', '/')}:/etc/nginx/xiaowork-locations.conf:ro`,
    ]
  }
  const override = path.join(state, 'compose.generated.yaml')
  // JSON is YAML-compatible. !override is needed only for replacing host ports.
  const rendered = JSON.stringify(
    { services, networks: { control: { ipam: { config: [{ subnet }] } } } },
    null,
    2,
  )
  fs.mkdirSync(state, { recursive: true, mode: 0o700 })
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
      ...process.env,
      V11_SOURCE_REVISION: spec.source,
      V11_BUILDER_ID: spec.images.worker,
      V11_LOCAL_PUBLISH: publish ? '1' : '0',
    },
  }
}
const composeArgs = (config) => [
  'compose',
  '-p',
  config.project,
  ...config.files.flatMap((file) => ['-f', file]),
  ...(config.publish ? ['--profile', 'publisher'] : []),
]
const compose = (config, args) => docker([...composeArgs(config), ...args], { env: config.env })
function start(config, first) {
  compose(config, ['config', '--quiet'])
  compose(config, ['up', '-d', '--no-build', 'publication-init', 'api-init'])
  if (first && config.topology === 'openresty') {
    const secret = tool(config.spec.images.maintenance, 'secret-status', [
      '--mount',
      `type=volume,src=${config.project}_admin-secrets,dst=/source/secrets,readonly`,
    ])
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
function publicProbe(config) {
  const evidence = []
  // Only loopback is ever requested. Host selects the production-like vhost.
  for (const route of ['/', '/projects', '/about', '/health.json', '/admin/']) {
    const data = execFileSync(
      process.execPath,
      [
        '-e',
        `fetch(${JSON.stringify(`http://127.0.0.1:${config.httpPort}${route}`)},{headers:{Host:'xiaoworks.com'}}).then(async r=>{if(!r.ok)process.exit(2);console.log(JSON.stringify({status:r.status,bytes:(await r.arrayBuffer()).byteLength}))}).catch(()=>process.exit(3))`,
      ],
      { encoding: 'utf8', timeout: 10000 },
    ).trim()
    evidence.push({ route, ...JSON.parse(data) })
  }
  return evidence
}
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
    const spec = validateSpec({ format: 1, source, schema: Number(options.schema ?? '3'), images })
    save(path.resolve(options.out), spec)
    console.log('Pinned local release descriptor written; operator review is still required.')
  } else {
    const project = projectName(options.project)
    const state = path.join(root, '.v11-deploy', project)
    fs.mkdirSync(state, { recursive: true, mode: 0o700 })
    const requestedLock = path.join(state, 'operation.lock')
    fs.mkdirSync(requestedLock, { mode: 0o700 })
    lock = requestedLock
    const currentFile = path.join(state, 'current.json')
    const previousFile = path.join(state, 'previous.json')
    assert.ok(
      !fs.existsSync(path.join(state, 'recovery-required.json')),
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
      if (present && !resuming)
        assert.equal(inspectProject(project, spec.images.maintenance).schema, spec.schema)
      const config = configuration(
        project,
        spec,
        state,
        options.topology ?? 'simulation',
        Number(options['http-port'] ?? 3216),
        Number(options['https-port'] ?? 3449),
        options.subnet ?? '192.168.245.0/28',
        options['local-publish'] === '1',
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
        process.exit(0)
      }
      if (command === 'stop') {
        compose(current, ['down'])
        console.log('Only the selected V1.1 project stopped; all volumes and images retained.')
        process.exit(0)
      }
      assert.ok(
        ['backup', 'update', 'rollback'].includes(command),
        'Expected attest|deploy|status|stop|backup|update|rollback',
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
      stopWriters(current)
      let backup
      try {
        const db = inspectProject(project, current.spec.images.maintenance)
        assert.equal(db.schema, current.spec.schema)
        if (replacement)
          tool(replacement.images.maintenance, 'compatible', [], ['-schema', String(db.schema)])
        const destination = path.resolve(
          options.backup ?? path.join(root, '.cache', 'v11-backups', `${project}-${Date.now()}`),
        )
        backup = backupProject(project, current.spec.images.maintenance, destination)
        if (!replacement) {
          start(current, false)
          console.log(
            JSON.stringify({ result: 'backup verified', backup: destination, state: backup.state }),
          )
          process.exit(0)
        }
        const next = configuration(
          project,
          replacement,
          state,
          current.topology,
          current.httpPort,
          current.httpsPort,
          current.subnet,
          current.publish,
        )
        try {
          const containers = start(next, false)
          const http = publicProbe(next)
          save(previousFile, prior)
          save(currentFile, {
            ...next,
            env: undefined,
            createdAt: new Date().toISOString(),
            containers,
            http,
            backup: destination,
          })
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
          stopWriters(next)
          try {
            const observed = inspectProject(project, current.spec.images.maintenance)
            assert.equal(observed.schema, current.spec.schema)
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
            publicProbe(old)
            throw Object.assign(
              new Error('Candidate failed; previous service restored and HTTP verified'),
              { safelyRestored: true },
            )
          } catch (recovery) {
            if (recovery.safelyRestored) throw recovery
            // Preserve the already-created atomic lock before attempting a
            // recovery record: ENOSPC must not accidentally unlock unsafe state.
            lock = undefined
            save(path.join(state, 'recovery-required.json'), {
              at: new Date().toISOString(),
              reason:
                'Candidate failed and previous service could not be safely verified; writers stopped',
              backup: destination,
              previous: current.spec,
              candidate: replacement,
            })
            throw new Error(
              'Manual recovery required; writers remain stopped and preserved recovery record blocks further updates',
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
} catch (error) {
  // No command output, environment, DB contents, Cookie or secret is exposed.
  console.error('V1.1 lifecycle refused:', error.message)
  process.exitCode = 1
}
