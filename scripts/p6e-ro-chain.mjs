// Test-controller only: consumes the freshly completed read-only-fix source pre-switch
// crash case, never the historical P6E fault volumes. No runtime fault API.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

const project = 'xiaowork-homepage-v11-p6e-ro-fault'
const recovered = 'xiaowork-homepage-v11-p6e-ro-repair'
const origin = 'https://localhost:3476'
const recoveryOrigin = 'https://localhost:3480'
const cache = path.resolve('.cache/p6e-ro-repair')
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-ro-runtime-manifest.json', 'utf8'))
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
const output = 'docs/evidence/P6E-ro-current-repair.json'
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
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  const readonlyMatrix = JSON.parse(
    fs.readFileSync('docs/evidence/P6E-ro-readonly-matrix.json', 'utf8'),
  )
  assert.equal(
    readonlyMatrix.result,
    'PASS',
    'No repair is authorized until the real read-only volume matrix has passed',
  )
  assert.equal(readonlyMatrix.source, manifest.source)
  assert.equal(readonlyMatrix.maintenance, maintenance)
  report.readonlyMatrix = {
    result: readonlyMatrix.result,
    source: readonlyMatrix.source,
    cases: readonlyMatrix.cases.length,
  }
  save()
  const beforeFault = JSON.parse(
    fs.readFileSync('docs/evidence/P6E-ro-faults-before-switch.json', 'utf8'),
  )
  assert.equal(beforeFault.project, project)
  assert.equal(beforeFault.case, 'before-switch')
  assert.equal(beforeFault.result, 'PASS')
  const helper = await import(
    pathToFileURL(path.resolve('.cache/p6e-ro-harness/p6e-fault-environment.mjs')).href
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
    boundary = 'p6e-ro-image-' + Date.now()
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
  report.publicBefore = await publicProof('http://127.0.0.1:3233')
  record(
    'trusted HTTPS account and persistent synthetic private upload prepared; current public version unchanged',
  )
  helper.compose('stop', '-t', '10', 'worker', 'api', 'api-init', 'publication-init')
  const actualImages = { ...finalImages }
  for (const [role, service] of Object.entries({
    api: 'api',
    worker: 'worker',
    gateway: 'gateway',
    frontend: 'frontend',
    static: 'publication-static',
  })) {
    const id = helper.compose('ps', '-aq', service)
    assert.match(id, /^[0-9a-f]{12,64}$/)
    actualImages[role] = docker(['inspect', '--format', '{{.Image}}', id])
  }
  report.faultRuntimeImages = actualImages
  const stateDir = path.resolve('.v11-deploy', project)
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const stateFile = path.join(stateDir, 'current.json')
  const state = {
    project,
    spec: { format: 1, source: manifest.source, schema: manifest.schema, images: actualImages },
  }
  if (fs.existsSync(stateFile))
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).spec, state.spec)
  else
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const plan = currentRepair('inspect', project, maintenance)
  assert.equal(plan.candidates.length, 1)
  assert.equal(plan.candidates[0].status, 'failed')
  assert.equal(plan.candidates[0].jobId, beforeFault.jobId)
  fs.writeFileSync(path.join(cache, 'repair-plan.json'), JSON.stringify(plan, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
  report.plan = { ...plan, files: undefined, fileCount: plan.files.length }
  const blockedBackup = path.resolve('.cache/v11-backups', 'p6e-ro-before-repair-' + Date.now())
  assert.throws(() => backupProject(project, maintenance, blockedBackup))
  record(
    'read-only intent/job/receipt/history/full-SHA plan identifies exactly the real pre-switch residual; backup still refuses it',
  )
  const applied = currentRepair(
    'apply',
    project,
    maintenance,
    plan.candidates[0].name,
    plan.sha256,
    'Confirmed terminal pre-switch test job and complete retained artifacts; remove redundant name only',
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
  assert.deepEqual(await publicProof('http://127.0.0.1:3233'), report.publicBefore)
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
  const backup = path.resolve('.cache/v11-backups', 'p6e-ro-repaired-' + Date.now())
  const backedUp = backupProject(project, maintenance, backup),
    verified = verifyBackup(maintenance, backup)
  report.backup = { state: backedUp.state, fileCount: backedUp.files.length, verified: true }
  assert.equal(verified.state.unfinished, 0)
  const restored = restoreProject(recovered, maintenance, backup)
  assert.deepEqual(restored, verified.state)
  const spec = { format: 1, source: manifest.source, schema: manifest.schema, images: finalImages }
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
      '3237',
      '--https-port',
      '3480',
      '--subnet',
      '192.168.236.0/28',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
  )
  report.publicAfter = await publicProof('http://127.0.0.1:3237')
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
  assert.ok(jobs.json.data.items.find((j) => j.id === beforeFault.jobId && j.status === 'failed'))
  record(
    'consistent repaired backup restored to new empty volumes; final six-role runtime started, original password works, old session rejected, private image/SQLite/history/public HTML and SEO match',
  )
  const restoredStateFile = path.resolve('.v11-deploy', recovered, 'current.json')
  const restoredState = JSON.parse(fs.readFileSync(restoredStateFile, 'utf8'))
  assert.equal(restoredState.publish, false)
  assert.deepEqual(restoredState.spec, spec)
  const updateBackup = path.resolve('.cache/v11-backups', 'p6e-ro-repaired-update-' + Date.now())
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
  assert.deepEqual(await publicProof('http://127.0.0.1:3237'), report.publicBefore)
  assert.deepEqual((await clone.request('/api/admin/v1/workspace')).json.data, workspace.json.data)
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
    'p6e-ro-repaired-cross-source-' + Date.now(),
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
  assert.deepEqual(await publicProof('http://127.0.0.1:3237'), report.publicBefore)
  assert.deepEqual((await clone.request('/api/admin/v1/workspace')).json.data, workspace.json.data)
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
    'p6e-ro-repaired-rollback-' + Date.now(),
  )
  const codeRollback = JSON.parse(
    execFileSync(
      process.execPath,
      ['scripts/v11-release.mjs', 'rollback', '--project', recovered, '--backup', rollbackBackup],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 360000 },
    ).trim(),
  )
  assert.equal(codeRollback.result, 'updated and verified')
  assert.equal(codeRollback.source, manifest.source)
  assert.deepEqual(await publicProof('http://127.0.0.1:3237'), report.publicBefore)
  assert.deepEqual((await clone.request('/api/admin/v1/workspace')).json.data, workspace.json.data)
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
    assert.equal(docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${owned}`]), '')
  }
  record(
    'only exact fresh test projects stopped; volumes, images, original fault evidence and backup retained',
  )
  // The known original failed 817 scene remains untouched. This is the NEW ro-fault project.
  // Repeating the already applied request is a refusal, never a second deletion.
  // Its expected indeterminate-operation guard is retained for audit, never cleared.
  const retainedMounts = Object.entries({
    db: 'admin-db',
    uploads: 'admin-uploads',
    publications: 'admin-publications',
    secrets: 'admin-secrets',
    authority: 'admin-authority',
    tls: 'admin-tls',
  }).flatMap(([role, suffix]) => [
    '--mount',
    'type=volume,src=' + project + '_' + suffix + ',dst=/source/' + role + ',readonly',
  ])
  const repeatInventoryCode = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const out=[];function walk(p){const s=fs.lstatSync(p,{bigint:true}),o={path:p.slice('/source/'.length),mode:String(s.mode),uid:String(s.uid),gid:String(s.gid),ino:String(s.ino),dev:String(s.dev),bytes:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),atimeNs:String(s.atimeNs)};if(s.isSymbolicLink())o.link=fs.readlinkSync(p);else if(s.isFile())o.sha256=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');else if(!s.isDirectory())throw Error('special file');out.push(o);if(s.isDirectory())for(const n of fs.readdirSync(p).sort())walk(path.join(p,n));}for(const n of fs.readdirSync('/source').sort())walk('/source/'+n);console.log(JSON.stringify(out));`
  const repeatInventory = () =>
    JSON.parse(
      docker([
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--user',
        '0:0',
        '--cap-drop',
        'ALL',
        '--cap-add',
        'DAC_OVERRIDE',
        '--security-opt',
        'no-new-privileges:true',
        ...retainedMounts,
        '--entrypoint',
        'node',
        finalImages.worker,
        '--eval',
        repeatInventoryCode,
      ]),
    )
  const repeatBefore = repeatInventory()
  let repeatedError
  try {
    currentRepair(
      'apply',
      project,
      maintenance,
      plan.candidates[0].name,
      plan.sha256,
      'Expected repeat of completed isolated test repair; must refuse without mutation',
    )
  } catch (error) {
    repeatedError = error
  }
  assert.ok(repeatedError, 'Already applied repair request must not succeed again')
  assert.equal(fs.existsSync(path.resolve('.v11-deploy', project, 'operation.lock')), true)
  const repeatAfter = repeatInventory()
  assert.deepEqual(repeatAfter, repeatBefore)
  fs.writeFileSync(
    path.join(cache, 'repeat-before.json'),
    JSON.stringify(repeatBefore, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  )
  fs.writeFileSync(
    path.join(cache, 'repeat-after.json'),
    JSON.stringify(repeatAfter, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  )
  report.repeatApply = {
    expected: 'REFUSE_WITHOUT_MUTATION_AND_RETAIN_LOCK',
    exitCode: repeatedError.status ?? 1,
    beforeSHA256: digest(Buffer.from(JSON.stringify(repeatBefore))),
    afterSHA256: digest(Buffer.from(JSON.stringify(repeatAfter))),
    allFilesAndMetadataUnchanged: true,
    operationLockRetained: true,
    lockProject: project,
  }
  record(
    'repeat of the applied single-object repair refused; all file metadata and SHA unchanged, only this new test project operation guard retained',
  )

  report.result = 'PASS'
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
