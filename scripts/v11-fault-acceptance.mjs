// Isolated V1.1 fault-injection acceptance (publication chain). API-driven, no
// browser. Operates ONLY on a dedicated project named xiaowork-homepage-v11-ft*
// deployed by v11-release.mjs (simulation topology, local publish gate), using
// test-only API/Worker/data images derived from the exact release group.
//
//   NODE_EXTRA_CA_CERTS=<probe-ca> FT_API=<tag> FT_WORKER=<tag> FT_DATA=<tag> \
//   node scripts/v11-fault-acceptance.mjs <case|all> --project P --secret F --out DIR
//
// Never prints credentials. Each case writes DIR/<case>.json; the first failing
// case stops the run and leaves the scene in place.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CASES = [
  'baseline',
  'compile-error',
  'timeout',
  'building-exit',
  'enospc',
  'api-restart',
  'sqlite-commit-exit',
  'after-switch',
  'static-restart',
  'corrupt-history',
  'http-unavailable',
  'recovery-fails',
  'before-switch',
]
export function parseArgs(argv) {
  const [name, ...rest] = argv
  assert.ok(name === 'all' || CASES.includes(name), 'Unknown fault case')
  const options = {}
  while (rest.length) {
    const key = rest.shift()
    assert.match(key ?? '', /^--(project|secret|out)$/)
    options[key.slice(2)] = rest.shift()
  }
  assert.match(options.project ?? '', /^xiaowork-homepage-v11-ft[a-z0-9-]{0,30}$/)
  assert.ok(options.secret && options.out)
  return { cases: name === 'all' ? CASES : [name], ...options }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const cli = (args, timeout = 300000) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 64 << 20 }).trim()

export function createHarness({ project, secret: secretFile, out }) {
  const state = path.join(root, '.v11-deploy', project)
  const current = JSON.parse(fs.readFileSync(path.join(state, 'current.json'), 'utf8'))
  assert.equal(current.project, project)
  assert.equal(current.topology, 'simulation')
  assert.equal(current.publish, true)
  const spec = current.spec
  const images = {
    api: process.env.FT_API,
    worker: process.env.FT_WORKER,
    data: process.env.FT_DATA,
  }
  for (const [role, tag] of Object.entries(images)) {
    assert.match(tag ?? '', /^xiaowork-homepage-v11-faulttest-[a-z]+:[a-f0-9]{12}$/, role)
    assert.equal(
      cli([
        'image',
        'inspect',
        '--format',
        '{{index .Config.Labels "io.xiaowork.test-only"}}',
        tag,
      ]),
      'fault-injection',
    )
    assert.equal(
      cli([
        'image',
        'inspect',
        '--format',
        '{{index .Config.Labels "org.opencontainers.image.revision"}}',
        tag,
      ]),
      spec.source,
    )
  }
  const secret = JSON.parse(fs.readFileSync(secretFile, 'utf8'))
  const ORIGIN = `https://localhost:${current.httpsPort}`
  const PUBLIC = `http://127.0.0.1:${current.httpPort}`
  const override = path.join(state, 'fault.override.yaml')
  const timeoutConfig = path.join(state, 'fault-timeout-nuxt.config.ts')
  fs.mkdirSync(out, { recursive: true, mode: 0o700 })
  const files = [
    path.join(root, 'compose.admin-publish.yaml'),
    path.join(state, 'compose.generated.yaml'),
    path.join(state, 'ports.generated.yaml'),
  ]
  const env = {
    ...process.env,
    V11_SOURCE_REVISION: spec.source,
    V11_BUILDER_ID: spec.images.worker,
    V11_LOCAL_PUBLISH: '1',
  }
  const compose = (...args) =>
    execFileSync(
      'docker',
      [
        'compose',
        '-p',
        project,
        ...[...files, ...(fs.existsSync(override) ? [override] : [])].flatMap((f) => ['-f', f]),
        '--profile',
        'publisher',
        ...args,
      ],
      { encoding: 'utf8', timeout: 300000, env, maxBuffer: 64 << 20 },
    ).trim()

  // ---------- test-only overrides (fixed modes; no arbitrary command/path) ----------
  function writeOverride(mode = 'none', variant = 'normal', verifierDown = false) {
    assert.ok(
      ['none', 'before-current-rename', 'after-current-rename', 'before-result-http'].includes(
        mode,
      ),
    )
    assert.ok(['normal', 'compile-error', 'timeout'].includes(variant))
    if (variant === 'timeout' && !fs.existsSync(timeoutConfig)) {
      const nuxt = fs.readFileSync(path.join(root, 'nuxt.config.ts'), 'utf8')
      assert.ok(nuxt.includes('  hooks: {'))
      fs.writeFileSync(
        timeoutConfig,
        nuxt.replace(
          '  hooks: {',
          "  hooks: {\n    async 'build:before'() { console.log('P6E_REAL_NUXT_TIMEOUT_HOOK'); await new Promise(resolve => setTimeout(resolve, 11 * 60 * 1000)) },",
        ),
      )
      fs.chmodSync(timeoutConfig, 0o644)
    }
    const mounts =
      variant === 'compile-error'
        ? `    volumes:\n      - ${path.join(root, 'scripts/fixtures/p6e-invalid-page.txt')}:/builder/app/pages/index.vue:ro\n`
        : variant === 'timeout'
          ? `    volumes:\n      - ${timeoutConfig}:/builder/nuxt.config.ts:ro\n`
          : ''
    fs.writeFileSync(
      override,
      `services:\n  api:\n    image: ${images.api}\n${verifierDown ? '    environment:\n      XIAOWORK_PUBLICATION_VERIFY_URL: http://publication-static:8099\n' : ''}  worker:\n    image: ${images.worker}\n    command: !override ["-test-mode", "${mode}", "-source-revision", "${spec.source}", "-builder-id", "${spec.images.worker}"]\n${mounts}`,
      { mode: 0o600 },
    )
  }
  function removeOverride() {
    if (fs.existsSync(override)) fs.unlinkSync(override)
  }
  const container = (service) => compose('ps', '-a', '-q', service)
  const running = (service) => {
    const id = container(service)
    return Boolean(id) && cli(['inspect', '--format', '{{.State.Running}}', id]) === 'true'
  }

  // ---------- API client ----------
  let cookie = ''
  let csrf = ''
  async function api(method, p, { body, ifMatch, idem, nonce } = {}) {
    const h = { Origin: ORIGIN }
    if (cookie) h.Cookie = cookie
    if (nonce || (csrf && method !== 'GET')) h['X-CSRF-Token'] = nonce ?? csrf
    if (ifMatch) h['If-Match'] = `"${ifMatch}"`
    if (idem) h['Idempotency-Key'] = idem
    if (body !== undefined) h['Content-Type'] = 'application/json'
    const r = await fetch(ORIGIN + '/api/admin/v1' + p, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    const set = r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .filter((c) => !c.endsWith('='))
    let json = null
    try {
      json = await r.json()
    } catch {
      json = null // non-JSON body (e.g. gateway 502); status alone is evaluated
    }
    return { status: r.status, json, set }
  }
  async function login() {
    cookie = ''
    csrf = ''
    for (let i = 0; i < 60; i++) {
      try {
        const ch = await api('GET', '/auth/login-challenge')
        if (ch.status === 200) {
          cookie = ch.set.join('; ')
          const r = await api('POST', '/auth/login', {
            body: { username: secret.username, password: secret.password },
            nonce: ch.json.data.loginNonce,
          })
          assert.equal(r.status, 200, 'login ' + r.status)
          cookie = r.set.join('; ')
          csrf = r.json.data.csrfToken
          return
        }
      } catch {
        // API restarting; retry until the bounded deadline
      }
      await sleep(2000)
    }
    throw new Error('API did not accept login')
  }
  async function read(p) {
    for (let attempt = 0; ; attempt++) {
      let r
      try {
        r = await api('GET', p)
      } catch (e) {
        if (attempt < 30) {
          await sleep(2000)
          continue
        }
        throw e
      }
      if (r.status === 401 && attempt < 3) {
        await login()
        continue
      }
      if ([502, 503].includes(r.status) && attempt < 30) {
        await sleep(2000)
        continue
      }
      assert.equal(r.status, 200, `GET ${p} ${r.status}`)
      return r.json.data
    }
  }
  async function http() {
    const result = []
    for (const route of ['/', '/projects/', '/about/', '/__xiaowork-release.json']) {
      try {
        const r = await fetch(PUBLIC + route, { cache: 'no-store' })
        result.push({ route, status: r.status, sha256: sha(Buffer.from(await r.arrayBuffer())) })
      } catch {
        result.push({ route, status: 'unavailable' })
      }
    }
    return result
  }
  const httpBody = (proof) => proof.map(({ route, status, sha256 }) => ({ route, status, sha256 }))

  // ---------- fixed inspectors (dedicated volumes only) ----------
  function db(command = 'inspect') {
    const volume = `${project}_admin-db`
    assert.equal(
      cli([
        'volume',
        'inspect',
        '--format',
        '{{index .Labels "com.docker.compose.project"}}',
        volume,
      ]),
      project,
    )
    return cli([
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      '10001:10001',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--mount',
      `type=volume,src=${volume},dst=/data`,
      images.data,
      command,
    ])
  }
  function pubfs(operation = 'state', id = '') {
    assert.ok(['state', 'damage', 'repair', 'root-readonly', 'root-writable'].includes(operation))
    if (id) assert.match(id, /^rel_[a-f0-9]{32}$/)
    const code = `const fs=require('fs');const crypto=require('crypto');const d=p=>{try{return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}catch{return null}};const r='/publications';const op=process.argv[1],id=process.argv[2];if(op==='state'){let c=null;try{c=fs.readlinkSync(r+'/current')}catch{};console.log(JSON.stringify({current:c,releases:fs.readdirSync(r+'/releases').sort().map(i=>({id:i,manifestSha256:d(r+'/releases/'+i+'/manifest.json'),homepageSha256:d(r+'/releases/'+i+'/public/index.html')})),currentNext:fs.readdirSync(r).filter(n=>n.startsWith('current.next.')),activations:fs.readdirSync(r+'/activations').length}))}else if(op==='root-readonly'){fs.chmodSync(r,0o500);try{fs.writeFileSync(r+'/ft-write-probe','x',{flag:'wx'});process.exit(8)}catch(e){console.log(JSON.stringify({code:e.code,mode:'0500'}));if(e.code!=='EACCES')process.exit(9)}}else if(op==='root-writable'){fs.chmodSync(r,0o700);console.log('"restored"')}else{const p=r+'/releases/'+id+'/public/index.html',h=r+'/releases/'+id+'/public/.ft-held-index';if(op==='damage')fs.renameSync(p,h);else fs.renameSync(h,p);console.log('"'+op+'"')}`
    const volume = `${project}_admin-publications`
    assert.equal(
      cli([
        'volume',
        'inspect',
        '--format',
        '{{index .Labels "com.docker.compose.project"}}',
        volume,
      ]),
      project,
    )
    return cli([
      'run',
      '--rm',
      '--network',
      'none',
      '--user',
      '10001:10001',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--mount',
      `type=volume,src=${volume},dst=/publications`,
      '--entrypoint',
      '/usr/local/bin/node',
      images.worker,
      '-e',
      code,
      '--',
      operation,
      id,
    ])
  }

  // ---------- reporting ----------
  let report
  const event = async (point, detail = {}) => {
    report.events.push({ time: new Date().toISOString(), point, ...detail })
    console.log('  -', point)
  }
  async function snapshot(point, jobId) {
    const status = await read('/publishing-status')
    const job = jobId ? (await read('/jobs/' + jobId)).job : null
    await event(point, {
      activeReleaseId: status.activeReleaseId,
      activeVerified: status.activeVerified,
      blockingJob: status.blockingJob?.id ?? null,
      job,
      sqlite: JSON.parse(db()).slice(-4),
      filesystem: JSON.parse(pubfs()),
      http: await http(),
    })
    return { status, job }
  }

  // ---------- worker/task helpers ----------
  async function waitAvailable(limit = 90000) {
    const until = Date.now() + limit
    while (Date.now() < until) {
      try {
        if ((await read('/publishing-status')).workerAvailable) return
      } catch {
        // transient while services are recreated
      }
      await sleep(1000)
    }
    throw new Error('Worker did not become available')
  }
  async function setWorker(
    mode = 'none',
    variant = 'normal',
    verifierDown = false,
    recreateApi = false,
  ) {
    writeOverride(mode, variant, verifierDown)
    try {
      compose('stop', '-t', '2', 'worker')
    } catch {
      // worker may already be stopped or killed by the fault itself
    }
    if (recreateApi)
      compose(
        'up',
        '-d',
        '--no-build',
        '--no-deps',
        '--force-recreate',
        '--wait',
        '--wait-timeout',
        '120',
        'api',
      )
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'worker')
    await waitAvailable()
  }
  async function reauth() {
    const r = await api('POST', '/auth/reauth', { body: { password: secret.password } })
    if (r.status === 401) {
      await login()
      return reauth()
    }
    assert.equal(r.status, 200)
  }
  async function submit(kind = 'publish', extra = {}) {
    await waitAvailable()
    await reauth()
    const w = await read('/workspace')
    const s = await read('/publishing-status')
    const body =
      kind === 'preview'
        ? {}
        : { confirmAllChanges: true, reviewedActiveReleaseId: s.activeReleaseId ?? null, ...extra }
    const r = await api('POST', `/${kind}-jobs`, {
      body,
      ifMatch: w.revision,
      idem: 'ft-' + randomBytes(12).toString('hex'),
    })
    await event('submission', {
      kind,
      httpStatus: r.status,
      error: r.json?.error?.code,
      jobId: r.json?.data?.jobId,
    })
    return r
  }
  async function submitOk(kind, extra) {
    const r = await submit(kind, extra)
    assert.equal(r.status, 202, `${kind} submission ${r.status} ${r.json?.error?.code}`)
    return r.json.data.jobId
  }
  async function waitTerminal(id, timeout = 360000) {
    const until = Date.now() + timeout
    let last = ''
    while (Date.now() < until) {
      const { job } = await read('/jobs/' + id)
      const s = JSON.stringify([job.status, job.phase, job.error?.code])
      if (s !== last) {
        await event('task-state', {
          status: job.status,
          phase: job.phase,
          error: job.error?.code ?? null,
        })
        last = s
      }
      if (['succeeded', 'failed'].includes(job.status)) return job
      await sleep(1000)
    }
    throw new Error('Task did not reach a terminal state')
  }
  async function waitBuild(id) {
    const until = Date.now() + 120000
    while (Date.now() < until) {
      const w = container('worker')
      if (
        w &&
        cli(['top', w, '-eo', 'pid,args']).includes(
          '/builder/node_modules/nuxt/bin/nuxt.mjs generate /work/',
        )
      ) {
        await event('real-nuxt-process-observed', { jobId: id })
        return
      }
      const j = (await read('/jobs/' + id)).job
      assert.ok(
        !['succeeded', 'failed'].includes(j.status),
        'Task ended before its build was observed',
      )
      await sleep(200)
    }
    throw new Error('Real Nuxt process not observed')
  }
  async function waitCheckpoint(service, point, limit = 300000) {
    const until = Date.now() + limit
    while (Date.now() < until) {
      if (compose('logs', '--no-log-prefix', service).includes('P6E_TEST_CHECKPOINT ' + point)) {
        await event('checkpoint-observed', { service, point })
        return
      }
      await sleep(300)
    }
    throw new Error('Checkpoint not observed: ' + point)
  }
  const continueCheckpoint = () =>
    compose(
      'exec',
      '-T',
      'worker',
      '/usr/local/bin/node',
      '-e',
      "require('fs').writeFileSync('/tmp/p6e-continue','continue')",
    )

  // ---------- cases ----------
  const cases = {
    async baseline() {
      const id = await submitOk('publish')
      const job = await waitTerminal(id)
      assert.equal(job.status, 'succeeded')
      await snapshot('after', id)
    },
    async 'compile-error'() {
      await buildFailure('compile-error', 300000)
    },
    async timeout() {
      await buildFailure('timeout', 760000)
    },
    async 'building-exit'() {
      const id = await submitOk('publish')
      await waitBuild(id)
      compose('kill', '-s', 'SIGKILL', 'worker')
      await snapshot('worker-killed-during-build', id)
      assert.deepEqual(httpBody(await http()), report.originalHttp)
      await setWorker()
      const job = await waitTerminal(id)
      assert.equal(job.status, 'failed')
      assert.equal(job.error?.code, 'INTERRUPTED_BEFORE_ACTIVATION')
      assert.deepEqual(httpBody(await http()), report.originalHttp)
      await snapshot('recovered', id)
    },
    async enospc() {
      const id = await submitOk('publish')
      await waitBuild(id)
      const fill = compose(
        'exec',
        '-T',
        'worker',
        '/usr/local/bin/node',
        '-e',
        "const f=require('fs');const a=f.statfsSync('/work');const before=a.bsize*a.bavail;const fd=f.openSync('/work/ft-enospc-filler','wx');const b=Buffer.alloc(1024*1024);let n=0,w=0;try{for(;n<4096;n++)w+=f.writeSync(fd,b);process.exit(3)}catch(e){const z=f.statfsSync('/work');console.log(JSON.stringify({code:e.code,writtenBytes:w,beforeAvailableBytes:before,afterAvailableBytes:z.bsize*z.bavail}));if(e.code!=='ENOSPC')process.exit(4)}finally{f.closeSync(fd)}",
      )
      report.kernelFailure = JSON.parse(fill)
      assert.equal(report.kernelFailure.code, 'ENOSPC')
      const job = await waitTerminal(id)
      assert.equal(job.status, 'failed')
      assert.deepEqual(httpBody(await http()), report.originalHttp)
      await snapshot('enospc-old-site-kept', id)
    },
    async 'api-restart'() {
      const id = await submitOk('publish')
      await waitBuild(id)
      compose('restart', '-t', '2', 'api')
      await event('api-restarted-during-real-build')
      await login()
      const until = Date.now() + 420000
      let job
      while (Date.now() < until) {
        job = (await read('/jobs/' + id)).job
        if (['succeeded', 'failed'].includes(job.status)) break
        if (!running('worker')) {
          await event('operator-restarted-fail-closed-worker')
          compose('start', 'worker')
        }
        await sleep(1000)
      }
      assert.ok(['succeeded', 'failed'].includes(job.status), 'api-restart task unresolved')
      const s = await read('/publishing-status')
      assert.equal(s.activeVerified, true)
      await snapshot('recovered', id)
    },
    async 'sqlite-commit-exit'() {
      await setWorker('before-result-http')
      const id = await submitOk('publish')
      await waitCheckpoint('worker', 'before-result-http')
      await snapshot('at-result-boundary', id)
      db('trigger-on')
      continueCheckpoint()
      await waitCheckpoint('api', 'sqlite-success-transaction')
      await event('sqlite-success-update-held-inside-transaction', { http: await http() })
      compose('kill', '-s', 'SIGKILL', 'api')
      db('trigger-off')
      compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'api')
      await login()
      compose('kill', '-s', 'SIGKILL', 'worker')
      await setWorker()
      const job = await waitTerminal(id)
      assert.equal(job.status, 'succeeded')
      await snapshot('recovered-after-boundary', id)
    },
    async 'after-switch'() {
      await setWorker('after-current-rename')
      const id = await submitOk('publish')
      await waitCheckpoint('worker', 'after-current-rename')
      await snapshot('at-activation-boundary', id)
      compose('kill', '-s', 'SIGKILL', 'worker')
      await setWorker()
      const job = await waitTerminal(id)
      assert.equal(job.status, 'succeeded')
      await snapshot('recovered-after-boundary', id)
    },
    async 'static-restart'() {
      await setWorker('after-current-rename')
      const id = await submitOk('publish')
      await waitCheckpoint('worker', 'after-current-rename')
      compose('restart', '-t', '2', 'publication-static')
      await event('static-restarted-at-current-rename')
      continueCheckpoint()
      const job = await waitTerminal(id)
      if (job.status === 'failed') {
        assert.equal(job.error?.code, 'ACTIVATION_RESTORED')
        assert.deepEqual(httpBody(await http()), report.originalHttp)
      } else assert.equal(job.status, 'succeeded')
      await setWorker()
      await snapshot('recovered-after-boundary', id)
    },
    async 'corrupt-history'() {
      const s = await read('/publishing-status')
      const target = (await read('/jobs')).items.find(
        (j) =>
          j.status === 'succeeded' && j.kind === 'publish' && j.releaseId !== s.activeReleaseId,
      )
      assert.ok(target, 'A distinct successful release is required')
      pubfs('damage', target.releaseId)
      await event('historical-html-moved-aside', { target: target.releaseId })
      try {
        const r = await submit('rollback', { targetReleaseId: target.releaseId })
        report.rejection = { status: r.status, error: r.json?.error?.code }
        if (r.status === 202) {
          const job = await waitTerminal(r.json.data.jobId)
          assert.equal(job.status, 'failed')
        } else assert.ok([409, 422].includes(r.status))
        assert.deepEqual(httpBody(await http()), report.originalHttp)
        await snapshot('damaged-history-rejected')
      } finally {
        pubfs('repair', target.releaseId)
        await event('historical-original-html-restored', { filesystem: JSON.parse(pubfs()) })
      }
    },
    async 'http-unavailable'() {
      await setWorker('none', 'normal', true, true)
      await login()
      const id = await submitOk('publish')
      const until = Date.now() + 420000
      for (;;) {
        const j = (await read('/jobs/' + id)).job
        assert.notEqual(j.status, 'succeeded', 'Unverified activation must never succeed')
        if (j.status === 'reconciling' && j.phase === 'recovery_required') break
        assert.ok(Date.now() < until, 'Expected recovery-required state not observed')
        await sleep(1000)
      }
      await snapshot('verifier-unavailable-recovery-blocked', id)
      assert.deepEqual(httpBody(await http()), report.originalHttp)
      await setWorker('none', 'normal', false, true)
      await login()
      if (!running('worker')) compose('start', 'worker')
      const job = await waitTerminal(id)
      assert.equal(job.status, 'failed')
      assert.equal(job.error?.code, 'ACTIVATION_RESTORED')
      assert.deepEqual(httpBody(await http()), report.originalHttp)
      await snapshot('verifier-restored-same-task-confirmed', id)
    },
    async 'recovery-fails'() {
      await setWorker('before-result-http', 'normal', true, true)
      await login()
      const id = await submitOk('publish')
      await waitCheckpoint('worker', 'before-result-http')
      await snapshot('new-release-active-before-verification', id)
      report.permission = JSON.parse(pubfs('root-readonly'))
      continueCheckpoint()
      const waitRecoveryExit = async (minimum) => {
        const until = Date.now() + 240000
        for (;;) {
          const row = JSON.parse(db()).find((j) => j.id === id)
          assert.notEqual(row.status, 'succeeded')
          if (
            row.attempts >= minimum &&
            row.status === 'reconciling' &&
            row.phase === 'recovery_required' &&
            !running('worker')
          )
            return
          assert.ok(
            Date.now() < until,
            'Expected restore write denial and stopped worker not observed',
          )
          await sleep(1000)
        }
      }
      await waitRecoveryExit(1)
      const first = await snapshot('restore-write-failed-recovery-required', id)
      assert.notEqual(first.status.activeReleaseId, report.originalActive)
      await setWorker('none', 'normal', true).catch(() => {})
      await waitRecoveryExit(2)
      await snapshot('second-restore-write-also-failed', id)
      const blocked = await submit('publish')
      assert.ok([409, 503].includes(blocked.status))
      report.newJobWhileUncertain = blocked.status
      pubfs('root-writable')
      report.permissionRestoredByOperator = true
      await setWorker('none', 'normal', false, true)
      await login()
      const job = await waitTerminal(id)
      assert.equal(job.status, 'succeeded')
      assert.equal(job.error, null)
      const row = JSON.parse(db()).find((j) => j.id === id)
      assert.equal(row.errorCodeIsNull, true)
      assert.equal(row.errorSummaryIsNull, true)
      assert.ok(row.failureAuditEvents >= 2)
      report.failureAuditEventsRetained = row.failureAuditEvents
      await snapshot('same-activation-verified-after-operator-repair', id)
    },
    async 'before-switch'() {
      await setWorker('before-current-rename')
      const id = await submitOk('publish')
      await waitCheckpoint('worker', 'before-current-rename')
      await snapshot('at-before-rename-boundary', id)
      compose('kill', '-s', 'SIGKILL', 'worker')
      await setWorker()
      const job = await waitTerminal(id)
      assert.equal(job.status, 'failed')
      assert.deepEqual(httpBody(await http()), report.originalHttp)
      const fsState = JSON.parse(pubfs())
      report.leftoverCurrentNext = fsState.currentNext
      const next = await submit('publish')
      report.newTaskWithLeftoverLink = { status: next.status, error: next.json?.error?.code }
      if (next.status === 202) await waitTerminal(next.json.data.jobId)
      await snapshot('failed-with-leftover-link', id)
    },
  }
  async function buildFailure(variant, limit) {
    await setWorker('none', variant)
    const started = Date.now()
    const id = await submitOk('publish')
    await waitBuild(id)
    const job = await waitTerminal(id, limit)
    report.elapsedMilliseconds = Date.now() - started
    assert.equal(job.status, 'failed')
    assert.equal(job.error?.code, 'BUILD_FAILED')
    if (variant === 'timeout') {
      report.taskElapsedMilliseconds = Date.parse(job.completedAt) - Date.parse(job.startedAt)
      assert.ok(report.taskElapsedMilliseconds >= 600000 - 2000)
    }
    assert.deepEqual(httpBody(await http()), report.originalHttp)
    await snapshot('failed-with-old-site', id)
    await setWorker()
  }

  async function run(names) {
    await login()
    writeOverride()
    compose(
      'up',
      '-d',
      '--no-build',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '120',
      'api',
    )
    await login()
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'worker')
    await waitAvailable()
    const pending = (await read('/jobs')).items.filter((j) =>
      ['queued', 'running', 'reconciling'].includes(j.status),
    )
    assert.equal(pending.length, 0, 'An existing uncertain task must be reconciled first')
    if (!(await read('/publishing-status')).activeReleaseId) {
      const id = await submitOk('publish')
      assert.equal((await waitTerminal(id)).status, 'succeeded')
    }
    const summary = []
    for (const name of names) {
      console.log('CASE', name)
      report = {
        case: name,
        project,
        sourceRevision: spec.source,
        formalImages: spec.images,
        testImages: Object.fromEntries(
          Object.entries(images).map(([k, v]) => [
            k,
            { tag: v, id: cli(['image', 'inspect', '--format', '{{.Id}}', v]) },
          ]),
        ),
        startedAt: new Date().toISOString(),
        events: [],
        result: 'RUNNING',
      }
      try {
        await waitAvailable()
        const before = await snapshot('before')
        report.originalActive = before.status.activeReleaseId
        report.originalHttp = httpBody(await http())
        await cases[name]()
        report.result = 'PASS'
      } catch (error) {
        report.result = 'FAIL'
        report.failure = String(error?.message ?? error).slice(0, 1500)
      } finally {
        report.finishedAt = new Date().toISOString()
        fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(report, null, 2), {
          mode: 0o600,
        })
      }
      summary.push({ case: name, result: report.result, failure: report.failure })
      console.log('RESULT', name, report.result, report.failure ?? '')
      if (report.result !== 'PASS') break
    }
    fs.writeFileSync(
      path.join(out, 'summary.json'),
      JSON.stringify({ project, date: new Date().toISOString(), summary }, null, 2),
    )
    return summary
  }
  function restoreFormal() {
    removeOverride()
    compose(
      'up',
      '-d',
      '--no-build',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '120',
      'api',
    )
    compose('up', '-d', '--no-build', '--no-deps', '--force-recreate', 'worker')
  }
  return { run, restoreFormal }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  const harness = createHarness(options)
  const summary = await harness.run(options.cases)
  const failed = summary.some((s) => s.result !== 'PASS')
  if (!failed && options.cases.at(-1) !== 'before-switch') harness.restoreFormal()
  console.log(
    `SUMMARY pass=${summary.filter((s) => s.result === 'PASS').length} fail=${summary.filter((s) => s.result !== 'PASS').length}`,
  )
  process.exitCode = failed ? 1 : 0
}
