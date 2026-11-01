// Test-controller only: consumes the freshly completed read-only-fix source pre-switch
// crash case, never the historical P6E fault volumes. No runtime fault API.
import assert from 'node:assert/strict'
import { execFileSync as realExecFileSync } from 'node:child_process'
import { protectedChain } from './v11-operation.mjs'
import { runLifecycle } from './v11-release.mjs'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { currentRepair } from './v11-current-repair.mjs'
import {
  backupProject,
  docker,
  inspectProject,
  restoreProject,
  verifyBackup,
} from './v11-maintenance.mjs'

// The lifecycle is invoked in-process to retain a non-transferable chain capability.
// Its image, schema, file, backup and HTTP checks are unchanged.
function execFileSync(file, args, options) {
  if (file === process.execPath && args[0] === 'scripts/v11-release.mjs') {
    const messages = [],
      original = console.log
    console.log = (...v) => messages.push(v.join(' '))
    try {
      runLifecycle(args.slice(1))
      report.lifecycleCommands ??= []
      report.lifecycleCommands.push({ args, exitCode: 0, messages })
      return messages.join('\n')
    } finally {
      console.log = original
    }
  }
  return realExecFileSync(file, args, options)
}
const project = 'xiaowork-homepage-v11-p6e-chain3-fault'
const recovered = 'xiaowork-homepage-v11-p6e-chain3-repair'
const origin = 'https://localhost:3523'
const recoveryOrigin = 'https://localhost:3527'
const cache = path.resolve('.cache/p6e-chain3-repair')
const manifest = JSON.parse(
  fs.readFileSync('docs/evidence/P6E-chain3-runtime-manifest.json', 'utf8'),
)
const finalImages = Object.fromEntries(
  Object.entries(manifest.images).map(([role, value]) => [role, value.id]),
)
const maintenance = finalImages.maintenance
const report = {
  date: new Date().toISOString(),
  project,
  recovered,
  source: manifest.source,
  finalImages,
  cases: [],
  result: 'RUNNING',
}
const output = 'docs/evidence/P6E-chain3-current-repair.json'
assert.equal(fs.existsSync(output), false, 'Never overwrite a preserved prior chain result')
const record = (name, detail = {}) => {
  report.cases.push({ name, result: 'PASS', ...detail })
  console.log('PASS ' + name)
  save()
}
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
const digest = (b) => createHash('sha256').update(b).digest('hex')

function png() {
  const crc32 = (b) => {
    let crc = 0xffffffff
    for (const value of b) {
      crc ^= value
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (name, bytes) => {
    const type = Buffer.from(name),
      length = Buffer.alloc(4),
      sum = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    sum.writeUInt32BE(crc32(Buffer.concat([type, bytes])))
    return Buffer.concat([length, type, bytes, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(64, 0)
  header.writeUInt32BE(40, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc((64 * 4 + 1) * 40)
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 64; x++) {
      const i = y * 257 + 1 + x * 4
      rows[i] = 88
      rows[i + 1] = 45
      rows[i + 2] = 140
      rows[i + 3] = 255
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function client(base, ca) {
  let cookies = new Map()
  return {
    cookies: () => [...cookies].map(([k, v]) => k + '=' + v).join('; '),
    setCookies: (value) => {
      cookies = new Map(value.split('; ').map((v) => v.split('=')))
    },
    request(route, method = 'GET', body, extra = {}) {
      return new Promise((resolve, reject) => {
        const bytes =
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? body
              : Buffer.from(JSON.stringify(body))
        const req = https.request(
          base + route,
          {
            method,
            ca,
            rejectUnauthorized: true,
            headers: {
              Origin: base,
              ...(cookies.size
                ? { Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') }
                : {}),
              ...(bytes
                ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length }
                : {}),
              ...extra,
            },
          },
          (res) => {
            const data = []
            for (const cookie of res.headers['set-cookie'] ?? []) {
              const [key, value] = cookie.split(';')[0].split('=')
              cookies.set(key, value)
            }
            res.on('data', (c) => data.push(c))
            res.on('end', () => {
              const bytes = Buffer.concat(data)
              let json
              try {
                json = JSON.parse(bytes)
              } catch {
                // Binary private images deliberately have no JSON response body.
              }
              resolve({ status: res.statusCode, headers: res.headers, bytes, json })
            })
          },
        )
        req.on('error', reject)
        if (bytes) req.write(bytes)
        req.end()
      })
    },
  }
}
async function login(c, credentials) {
  const challenge = await c.request('/api/admin/v1/auth/login-challenge')
  assert.equal(challenge.status, 200)
  const result = await c.request('/api/admin/v1/auth/login', 'POST', credentials, {
    'X-CSRF-Token': challenge.json.data.loginNonce,
  })
  assert.equal(result.status, 200)
  return result.json.data
}
async function publicProof(base) {
  const result = []
  for (const route of [
    '/',
    '/projects/',
    '/about/',
    '/sitemap.xml',
    '/robots.txt',
    '/__xiaowork-release.json',
  ]) {
    const r = await fetch(base + route, { cache: 'no-store' })
    assert.equal(r.status, 200)
    result.push({ route, status: r.status, sha256: digest(Buffer.from(await r.arrayBuffer())) })
  }
  return result
}

try {
  await protectedChain(
    [
      project,
      recovered,
      'xiaowork-homepage-v11-p6e-chain3-content',
      'xiaowork-homepage-v11-p6e-chain3-again',
    ],
    'p6e-full-repair-chain',
    async () => {
      fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
      const readonlyMatrix = JSON.parse(
        fs.readFileSync('docs/evidence/P6E-atime2-readonly-matrix.json', 'utf8'),
      )
      assert.equal(
        readonlyMatrix.result,
        'PASS',
        'No repair is authorized until the real read-only volume matrix has passed',
      )
      assert.equal(readonlyMatrix.source, 'bb05f6ad613fdf3507ff8a9c56696da85fa4a678')
      report.priorReadonlyMatrix = {
        source: readonlyMatrix.source,
        retainedHistoricalPrerequisite: true,
        notClaimedAsNewCandidateMatrix: true,
      }
      const guards = JSON.parse(fs.readFileSync('docs/evidence/P6E-atime2-real-guards.json'))
      assert.equal(guards.result, 'PASS', 'Real lock fault matrix must pass before any repair')
      assert.equal(guards.source, readonlyMatrix.source)
      report.readonlyMatrix = {
        result: readonlyMatrix.result,
        source: readonlyMatrix.source,
        cases: readonlyMatrix.cases.length,
      }
      save()
      const initialHelper = await import(
        pathToFileURL(path.resolve('.cache/p6e-chain3-harness/p6e-fault-environment.mjs')).href
      )
      process.env.CHAIN3_OFFICIAL = '1'
      await initialHelper.prepareEnvironment()
      const officialSpec = {
        format: 1,
        source: manifest.source,
        schema: manifest.schema,
        images: finalImages,
      }
      const initialStateDir = path.resolve('.v11-deploy', project)
      fs.writeFileSync(
        path.join(initialStateDir, 'current.json'),
        JSON.stringify({ project, spec: officialSpec }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      )
      const initialContainers = []
      for (const [service, role] of Object.entries({
        api: 'api',
        'api-init': 'api',
        worker: 'worker',
        'publication-init': 'worker',
        gateway: 'gateway',
        frontend: 'frontend',
        'publication-static': 'static',
      })) {
        const id = initialHelper.compose('ps', '-aq', service)
        const actual = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
        assert.equal(actual.Image, finalImages[role])
        initialContainers.push({
          service,
          image: actual.Image,
          running: actual.State.Running,
          health: actual.State.Health?.Status,
        })
      }
      report.initialOfficialRuntime = initialContainers
      record(
        'new isolated project starts from the complete formal six-role descriptor, including init roles',
      )
      delete process.env.CHAIN3_OFFICIAL
      for (const name of ['baseline', 'before-switch']) {
        execFileSync(process.execPath, ['scripts/p6e-chain3-acceptance.mjs', 'fault', name], {
          stdio: 'inherit',
          timeout: 1200000,
        })
        const proof = JSON.parse(
          fs.readFileSync('docs/evidence/P6E-chain3-faults-' + name + '.json'),
        )
        assert.equal(proof.result, 'PASS')
        assert.equal(proof.sourceRevision, manifest.source)
      }
      const beforeFault = JSON.parse(
        fs.readFileSync('docs/evidence/P6E-chain3-faults-before-switch.json', 'utf8'),
      )
      assert.equal(beforeFault.project, project)
      assert.equal(beforeFault.case, 'before-switch')
      assert.equal(beforeFault.result, 'PASS')
      const helper = await import(
        pathToFileURL(path.resolve('.cache/p6e-chain3-harness/p6e-fault-environment.mjs')).href
      )
      const trust = await helper.prepareEnvironment()
      assert.equal(helper.project, project)
      const credentials = await helper.initializeTestAdministrator()
      const ca = fs.readFileSync(trust.caPath),
        source = client(origin, ca)
      const session = await login(source, credentials)
      const ws = await source.request('/api/admin/v1/workspace')
      assert.equal(ws.status, 200)
      const fixture = png(),
        boundary = 'p6e-chain3-image-' + Date.now()
      const multipart = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-repair-fixture.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        fixture,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const upload = await source.request('/api/admin/v1/media', 'POST', multipart, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-CSRF-Token': session.csrfToken,
        'If-Match': '"' + ws.json.data.revision + '"',
      })
      assert.equal(upload.status, 201)
      const media = upload.json.data.media
      const privateImage = await source.request(media.contentUrl)
      assert.equal(privateImage.status, 200)
      assert.equal(digest(privateImage.bytes), media.sha256)
      const workspace = await source.request('/api/admin/v1/workspace')
      assert.equal(workspace.status, 200)
      report.syntheticImage = {
        id: media.id,
        sha256: media.sha256,
        bytes: media.byteSize,
        note: 'Locally generated test fixture; never a real project screenshot',
      }
      const oldCookie = source.cookies()
      report.publicBefore = await publicProof('http://127.0.0.1:3273')
      record(
        'trusted HTTPS account and persistent synthetic private upload prepared; current public version unchanged',
      )
      helper.compose('stop', '-t', '10', 'worker', 'api', 'api-init', 'publication-init')
      report.faultRuntimeImages = Object.fromEntries(
        ['api', 'worker', 'api-init', 'publication-init'].map((service) => [
          service,
          docker(['inspect', '--format', '{{.Image}}', helper.compose('ps', '-aq', service)]),
        ]),
      )
      process.env.CHAIN3_OFFICIAL = '1'
      process.env.V11_SOURCE_REVISION = manifest.source
      process.env.V11_BUILDER_ID = finalImages.worker
      await helper.configureWorker()
      helper.compose(
        'create',
        '--no-build',
        '--force-recreate',
        'api-init',
        'publication-init',
        'api',
        'worker',
      )
      const formalIdentity = []
      for (const [service, role] of Object.entries({
        api: 'api',
        'api-init': 'api',
        worker: 'worker',
        'publication-init': 'worker',
        gateway: 'gateway',
        frontend: 'frontend',
        'publication-static': 'static',
      })) {
        const id = helper.compose('ps', '-aq', service),
          actual = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
        assert.equal(actual.Image, finalImages[role])
        if (['api', 'worker', 'api-init', 'publication-init'].includes(service))
          assert.equal(actual.State.Running, false)
        formalIdentity.push({ service, image: actual.Image, running: actual.State.Running })
      }
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.resolve('.v11-deploy', project, 'current.json'))).spec,
        officialSpec,
      )
      report.formalHandoff = {
        containers: formalIdentity,
        source: manifest.source,
        descriptorUnchanged: true,
        writersStopped: true,
        historicalBuilder: beforeFault.testWorkerImage,
        newBuilder: finalImages.worker,
      }
      record(
        'fault phase ended; stopped writers recreated as formal images including init roles; descriptor unchanged',
      )
      const plan = currentRepair('inspect', project, maintenance)
      assert.equal(plan.candidates.length, 1)
      assert.equal(plan.candidates[0].status, 'failed')
      assert.equal(plan.candidates[0].jobId, beforeFault.jobId)
      fs.writeFileSync(path.join(cache, 'repair-plan.json'), JSON.stringify(plan, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      })
      report.plan = { ...plan, files: undefined, fileCount: plan.files.length }
      const applied = currentRepair(
        'apply',
        project,
        maintenance,
        plan.candidates[0].name,
        plan.sha256,
        'Confirmed terminal pre-switch test job and complete retained artifacts; remove redundant name only',
        (_result, proof) => {
          report.repairMetadata = { before: proof.before, after: proof.after }
          fs.writeFileSync(
            'docs/evidence/P6E-chain3-repair-metadata.json',
            JSON.stringify(report.repairMetadata, null, 2) + '\n',
            { flag: 'wx' },
          )
        },
      )
      assert.equal(applied.outcome, 'verified-redundant-link-removed')
      assert.equal(applied.afterFiles.length, plan.files.length - 1)
      assert.deepEqual(
        applied.afterFiles,
        plan.files.filter((file) => file.path !== 'publications/' + plan.candidates[0].name),
      )
      assert.equal(applied.afterSha256, digest(Buffer.from(JSON.stringify(applied.afterFiles))))
      fs.writeFileSync(
        path.join(cache, 'repair-result.json'),
        JSON.stringify(applied, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      )
      assert.deepEqual(await publicProof('http://127.0.0.1:3273'), report.publicBefore)
      assert.equal(currentRepair('inspect', project, maintenance).candidates.length, 0)
      report.repair = {
        id: applied.id,
        outcome: applied.outcome,
        afterSHA256: applied.afterSha256,
        afterFileCount: applied.afterFiles.length,
        completePerFileSHA256Comparison: true,
        fullManifestStorage: 'Private local test-controller cache and persistent volume audit',
        state: inspectProject(project, maintenance),
      }
      record(
        'single-object repair persisted intent/result, all other file SHAs and active HTTP stayed identical',
      )
      const backup = path.resolve('.cache/v11-backups', 'p6e-chain3-repaired-' + Date.now())
      const backedUp = backupProject(project, maintenance, backup),
        verified = verifyBackup(maintenance, backup)
      report.backup = { state: backedUp.state, fileCount: backedUp.files.length, verified: true }
      assert.equal(verified.state.unfinished, 0)
      const restored = restoreProject(recovered, maintenance, backup)
      assert.deepEqual(restored, verified.state)
      const spec = {
        format: 1,
        source: manifest.source,
        schema: manifest.schema,
        images: finalImages,
      }
      const specFile = path.join(cache, 'final-restore-runtime.json')
      fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n')
      execFileSync(
        process.execPath,
        [
          'scripts/v11-release.mjs',
          'deploy',
          '--project',
          recovered,
          '--manifest',
          specFile,
          '--restored',
          '1',
          '--http-port',
          '3277',
          '--https-port',
          '3527',
          '--subnet',
          '192.168.219.0/28',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
      )
      report.publicAfter = await publicProof('http://127.0.0.1:3277')
      assert.deepEqual(report.publicAfter, report.publicBefore)
      const clone = client(recoveryOrigin, ca)
      clone.setCookies(oldCookie)
      assert.equal((await clone.request('/api/admin/v1/auth/session')).status, 401)
      await login(clone, credentials)
      const cloneWorkspace = await clone.request('/api/admin/v1/workspace')
      assert.equal(cloneWorkspace.status, 200)
      assert.deepEqual(cloneWorkspace.json.data, workspace.json.data)
      const cloneImage = await clone.request(media.contentUrl)
      assert.equal(cloneImage.status, 200)
      assert.equal(digest(cloneImage.bytes), media.sha256)
      assert.equal((await clone.request('/admin/')).status, 200)
      const jobs = await clone.request('/api/admin/v1/jobs')
      assert.equal(jobs.status, 200)
      assert.ok(
        jobs.json.data.items.find((j) => j.id === beforeFault.jobId && j.status === 'failed'),
      )
      record(
        'consistent repaired backup restored to new empty volumes; final six-role runtime started, original password works, old session rejected, private image/SQLite/history/public HTML and SEO match',
      )
      const restoredStateFile = path.resolve('.v11-deploy', recovered, 'current.json')
      const restoredState = JSON.parse(fs.readFileSync(restoredStateFile, 'utf8'))
      assert.equal(restoredState.publish, false)
      assert.deepEqual(restoredState.spec, spec)
      const updateBackup = path.resolve(
        '.cache/v11-backups',
        'p6e-chain3-repaired-update-' + Date.now(),
      )
      const update = JSON.parse(
        execFileSync(
          process.execPath,
          [
            'scripts/v11-release.mjs',
            'update',
            '--project',
            recovered,
            '--manifest',
            specFile,
            '--backup',
            updateBackup,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
        ).trim(),
      )
      assert.equal(update.result, 'updated and verified')
      assert.equal(update.source, manifest.source)
      const updateVerified = verifyBackup(maintenance, updateBackup)
      assert.deepEqual(updateVerified.state, backedUp.state)
      assert.deepEqual(await publicProof('http://127.0.0.1:3277'), report.publicBefore)
      assert.deepEqual(
        (await clone.request('/api/admin/v1/workspace')).json.data,
        workspace.json.data,
      )
      const updatedPrivateImage = await clone.request(media.contentUrl)
      assert.equal(updatedPrivateImage.status, 200)
      assert.equal(digest(updatedPrivateImage.bytes), media.sha256)
      assert.equal((await clone.request('/admin/')).status, 200)
      assert.equal((await clone.request('/api/admin/v1/jobs')).status, 200)
      const updatedState = JSON.parse(fs.readFileSync(restoredStateFile, 'utf8'))
      assert.equal(updatedState.publish, false)
      assert.deepEqual(updatedState.spec, spec)
      const updatedContainers = []
      for (const [role, service] of Object.entries({
        api: 'api',
        gateway: 'gateway',
        frontend: 'frontend',
        static: 'publication-static',
      })) {
        const id = docker([
          'compose',
          '-p',
          recovered,
          ...updatedState.files.flatMap((file) => ['-f', file]),
          'ps',
          '-q',
          service,
        ])
        assert.match(id, /^[0-9a-f]{12,64}$/)
        const actual = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
        assert.equal(actual.Image, finalImages[role])
        assert.equal(actual.State.Running, true)
        assert.equal(actual.State.Health.Status, 'healthy')
        updatedContainers.push({ role, image: actual.Image, health: actual.State.Health.Status })
      }
      for (const member of ['operation.lock', 'recovery-required.json'])
        assert.equal(fs.existsSync(path.resolve('.v11-deploy', recovered, member)), false)
      assert.equal(
        docker([
          'ps',
          '-q',
          '--filter',
          `label=com.docker.compose.project=${recovered}`,
          '--filter',
          'label=com.docker.compose.service=worker',
        ]),
        '',
      )
      report.postRepairUpdate = {
        command:
          'node scripts/v11-release.mjs update --project ' +
          recovered +
          ' --manifest <final-six-role-spec> --backup <new-private-directory>',
        result: update.result,
        source: update.source,
        images: updatedState.spec.images,
        containers: updatedContainers,
        workerDefaultOff: true,
        schema: updateVerified.state.schema,
        state: updateVerified.state,
        gateEnabled: updatedState.publish,
        lockRetained: false,
        note: 'Same-source replay verifies repaired data acceptance; the next steps perform a full historical-source update and rollback to this group',
      }
      record(
        'real post-repair six-role lifecycle update completed with stopped-writer backup and old/new offline checks; HTTP/SEO/admin/private image/workspace preserved, gate stayed off, no residual operation lock',
      )

      // Code transition only; schema remains 3 and no content rollback or DB downgrade.
      // 817 is a complete historical six-role group, never mixed into the new final group.
      const previousManifest = JSON.parse(
        fs.readFileSync('docs/evidence/P6E-final-runtime-manifest.json', 'utf8'),
      )
      assert.equal(previousManifest.source, '817aa533741bdd5de23f322fa5e5171442cb28a9')
      assert.equal(previousManifest.schema, manifest.schema)
      const previousSpec = {
        format: 1,
        source: previousManifest.source,
        schema: previousManifest.schema,
        images: Object.fromEntries(
          Object.entries(previousManifest.images).map(([role, image]) => [role, image.id]),
        ),
      }
      const previousSpecFile = path.join(cache, 'historical-six-role-spec.json')
      fs.writeFileSync(previousSpecFile, JSON.stringify(previousSpec, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      })
      const sourceUpdateBackup = path.resolve(
        '.cache/v11-backups',
        'p6e-chain3-repaired-cross-source-' + Date.now(),
      )
      const previousUpdate = JSON.parse(
        execFileSync(
          process.execPath,
          [
            'scripts/v11-release.mjs',
            'update',
            '--project',
            recovered,
            '--manifest',
            previousSpecFile,
            '--backup',
            sourceUpdateBackup,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
        ).trim(),
      )
      assert.equal(previousUpdate.result, 'updated and verified')
      assert.equal(previousUpdate.source, previousManifest.source)
      assert.deepEqual(await publicProof('http://127.0.0.1:3277'), report.publicBefore)
      assert.deepEqual(
        (await clone.request('/api/admin/v1/workspace')).json.data,
        workspace.json.data,
      )
      assert.equal((await clone.request('/admin/')).status, 200)
      const historicalImage = await clone.request(media.contentUrl)
      assert.equal(historicalImage.status, 200)
      assert.equal(digest(historicalImage.bytes), media.sha256)
      const priorRuntime = JSON.parse(fs.readFileSync(restoredStateFile, 'utf8'))
      assert.deepEqual(priorRuntime.spec, previousSpec)
      assert.equal(priorRuntime.publish, false)
      record(
        'post-repair cross-source update uses the full historical 817 six-role group, unchanged schema/content, real HTTP/admin/private image proof',
      )
      const rollbackBackup = path.resolve(
        '.cache/v11-backups',
        'p6e-chain3-repaired-rollback-' + Date.now(),
      )
      const codeRollback = JSON.parse(
        execFileSync(
          process.execPath,
          [
            'scripts/v11-release.mjs',
            'rollback',
            '--project',
            recovered,
            '--backup',
            rollbackBackup,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
        ).trim(),
      )
      assert.equal(codeRollback.result, 'updated and verified')
      assert.equal(codeRollback.source, manifest.source)
      assert.deepEqual(await publicProof('http://127.0.0.1:3277'), report.publicBefore)
      assert.deepEqual(
        (await clone.request('/api/admin/v1/workspace')).json.data,
        workspace.json.data,
      )
      assert.equal((await clone.request('/admin/')).status, 200)
      const rollbackImage = await clone.request(media.contentUrl)
      assert.equal(rollbackImage.status, 200)
      assert.equal(digest(rollbackImage.bytes), media.sha256)
      const rolledRuntime = JSON.parse(fs.readFileSync(restoredStateFile, 'utf8'))
      assert.deepEqual(rolledRuntime.spec, spec)
      assert.equal(rolledRuntime.publish, false)
      const rollbackContainers = []
      for (const [role, service] of Object.entries({
        api: 'api',
        gateway: 'gateway',
        frontend: 'frontend',
        static: 'publication-static',
      })) {
        const id = docker([
          'compose',
          '-p',
          recovered,
          ...rolledRuntime.files.flatMap((file) => ['-f', file]),
          'ps',
          '-q',
          service,
        ])
        const actual = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
        assert.equal(actual.Image, finalImages[role])
        assert.equal(actual.State.Running, true)
        assert.equal(actual.State.Health.Status, 'healthy')
        rollbackContainers.push({ role, image: actual.Image, health: actual.State.Health.Status })
      }
      for (const member of ['operation.lock', 'recovery-required.json'])
        assert.equal(fs.existsSync(path.resolve('.v11-deploy', recovered, member)), false)
      report.postRepairCrossSourceRollback = {
        previousSource: manifest.source,
        intermediateSource: previousManifest.source,
        finalSource: codeRollback.source,
        schema: manifest.schema,
        sourceUpdate: previousUpdate,
        rollback: codeRollback,
        finalImages,
        containers: rollbackContainers,
        gateEnabled: false,
        lockRetained: false,
        changes:
          'code only; no database downgrade, no content-version rollback or disaster-restore performed by update',
      }
      record(
        'real code rollback returns to the complete new six-role group; HTTP/SEO/admin/image/workspace match, gate off, no operation lock',
      )

      // A separate empty-volume clone opts into the localhost-only test gate.
      // The default-off recovered instance above is never silently enabled.
      const contentProject = 'xiaowork-homepage-v11-p6e-chain3-content'
      const secondRestore = 'xiaowork-homepage-v11-p6e-chain3-again'
      const afterCodeBackup = path.resolve(
        '.cache/v11-backups',
        'p6e-chain3-after-code-' + Date.now(),
      )
      const lifecycle = (args) =>
        JSON.parse(
          execFileSync(process.execPath, ['scripts/v11-release.mjs', ...args], {
            encoding: 'utf8',
            timeout: 360000,
          }).trim(),
        )
      lifecycle(['backup', '--project', recovered, '--backup', afterCodeBackup])
      restoreProject(contentProject, maintenance, afterCodeBackup)
      lifecycle([
        'deploy',
        '--project',
        contentProject,
        '--manifest',
        specFile,
        '--restored',
        '1',
        '--http-port',
        '3287',
        '--https-port',
        '3537',
        '--subnet',
        '192.168.218.0/28',
        '--local-publish',
        '1',
      ])
      const contentClient = client('https://localhost:3537', ca)
      const contentSession = await login(contentClient, credentials)
      async function mutation(c, session, route, body, method = 'POST') {
        const w = await c.request('/api/admin/v1/workspace')
        assert.equal(w.status, 200)
        const r = await c.request('/api/admin/v1' + route, method, body, {
          'X-CSRF-Token': session.csrfToken,
          'If-Match': '"' + w.json.data.revision + '"',
          'Idempotency-Key': randomUUID(),
        })
        assert.ok(
          [200, 202].includes(r.status),
          'Real content operation refused: ' + r.status + ' ' + r.json?.error?.code,
        )
        return r.json.data
      }
      async function job(kind, target) {
        if (kind !== 'preview') {
          const r = await contentClient.request(
            '/api/admin/v1/auth/reauth',
            'POST',
            { password: credentials.password },
            { 'X-CSRF-Token': contentSession.csrfToken },
          )
          assert.equal(r.status, 200)
        }
        const status = await contentClient.request('/api/admin/v1/publishing-status')
        assert.equal(status.status, 200)
        const body =
          kind === 'preview'
            ? {}
            : {
                confirmAllChanges: true,
                reviewedActiveReleaseId: status.json.data.activeReleaseId,
                ...(target ? { targetReleaseId: target } : {}),
              }
        const queued = await mutation(contentClient, contentSession, '/' + kind + '-jobs', body)
        const deadline = Date.now() + 600000
        while (Date.now() < deadline) {
          const r = await contentClient.request('/api/admin/v1/jobs/' + queued.jobId)
          assert.equal(r.status, 200)
          const value = r.json.data.job
          if (value.status === 'succeeded') return value
          assert.ok(
            ['queued', 'running', 'reconciling'].includes(value.status),
            'Task failed: ' + value.error?.code,
          )
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }
        throw Error('New-candidate real Nuxt job timeout')
      }
      const contentA = await job('publish')
      const proofA = await publicProof('http://127.0.0.1:3287')
      const contentWorkspace = (await contentClient.request('/api/admin/v1/workspace')).json.data
      const projectFields = [
        'slug',
        'name',
        'summary',
        'description',
        'categoryId',
        'techStack',
        'status',
        'featured',
        'visible',
        'isPlaceholder',
        'cover',
        'coverAlt',
        'coverKind',
        'demoUrl',
        'repositoryUrl',
      ]
      const input = Object.fromEntries(
        projectFields.map((k) => [k, contentWorkspace.projects[0][k]]),
      )
      input.summary = '专用本地修复链B；项目资料仍待确认。'
      await mutation(
        contentClient,
        contentSession,
        '/projects/' + contentWorkspace.projects[0].id,
        input,
        'PUT',
      )
      const contentB = await job('publish')
      assert.notEqual(contentA.releaseId, contentB.releaseId)
      const draftB = (await contentClient.request('/api/admin/v1/workspace')).json.data
      const restoredContent = await job('rollback', contentA.releaseId)
      assert.equal(restoredContent.releaseId, contentA.releaseId)
      assert.deepEqual(await publicProof('http://127.0.0.1:3287'), proofA)
      assert.deepEqual((await contentClient.request('/api/admin/v1/workspace')).json.data, draftB)
      const preview = await job('preview')
      assert.equal(
        (await contentClient.request('/api/admin/v1/previews/' + preview.releaseId + '/')).status,
        200,
      )
      const anonymous = client('https://localhost:3537', ca)
      assert.equal(
        (await anonymous.request('/api/admin/v1/previews/' + preview.releaseId + '/')).status,
        401,
      )
      report.postRepairContentRecovery = {
        project: contentProject,
        source: manifest.source,
        builderIdentity: finalImages.worker,
        A: contentA,
        B: contentB,
        restored: restoredContent,
        preview,
        unchangedDraftRevision: draftB.revision,
        anonymousPreview: 401,
        publicHTTP: proofA,
      }
      record(
        'post-code-rollback empty-volume clone: exact final Worker real A/B publish, content restore A retains draft B, authenticated preview and anonymous refusal',
      )
      const againBackup = path.resolve('.cache/v11-backups', 'p6e-chain3-again-' + Date.now())
      lifecycle(['backup', '--project', contentProject, '--backup', againBackup])
      const againVerified = verifyBackup(maintenance, againBackup)
      assert.equal(againVerified.state.activeRelease, contentA.releaseId)
      const againState = restoreProject(secondRestore, maintenance, againBackup)
      assert.deepEqual(againState, againVerified.state)
      lifecycle([
        'deploy',
        '--project',
        secondRestore,
        '--manifest',
        specFile,
        '--restored',
        '1',
        '--http-port',
        '3297',
        '--https-port',
        '3547',
        '--subnet',
        '192.168.217.0/28',
      ])
      const againClient = client('https://localhost:3547', ca)
      await login(againClient, credentials)
      assert.deepEqual((await againClient.request('/api/admin/v1/workspace')).json.data, draftB)
      assert.equal(digest((await againClient.request(media.contentUrl)).bytes), media.sha256)
      assert.deepEqual(await publicProof('http://127.0.0.1:3297'), proofA)
      report.secondBackupRestore = {
        project: secondRestore,
        state: againState,
        publicHTTP: proofA,
        privateImageSHA256: media.sha256,
        gateEnabled: false,
      }
      record(
        'after content restore, second consistent backup and independent new empty-volume restore preserve database/draft/private image/public HTML and SEO; default gate remains off',
      )
      for (const extra of [secondRestore, contentProject])
        execFileSync(process.execPath, ['scripts/v11-release.mjs', 'stop', '--project', extra], {
          encoding: 'utf8',
          timeout: 180000,
        })

      execFileSync(process.execPath, ['scripts/v11-release.mjs', 'stop', '--project', recovered], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 180000,
      })
      const stoppedRestoredState = inspectProject(recovered, maintenance)
      assert.deepEqual(stoppedRestoredState, backedUp.state)
      report.finalStoppedDatabaseState = stoppedRestoredState
      helper.compose('down', '--remove-orphans')
      for (const owned of [project, recovered]) {
        const names = docker([
          'volume',
          'ls',
          '--filter',
          `label=com.docker.compose.project=${owned}`,
          '--format',
          '{{.Name}}',
        ])
          .split(/\s+/)
          .filter(Boolean)
        assert.ok(names.length >= 6)
        assert.equal(
          docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${owned}`]),
          '',
        )
      }
      record(
        'only exact fresh test projects stopped; volumes, images, original fault evidence and backup retained',
      )
      report.result = 'PASS'
    },
  )
  report.guardsReleasedAfterFullAcceptance = true
} catch (error) {
  report.result = 'FAIL'
  report.error =
    error?.code === 'ERR_ASSERTION'
      ? error.message
      : 'Controlled read-only repair chain stopped; inspect private local command log without publishing credentials'
  console.error(report.error)
  process.exitCode = 1
} finally {
  save()
}
