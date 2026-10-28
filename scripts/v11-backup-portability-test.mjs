import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { docker, localEngine, restoreProject, verifyBackup } from './v11-maintenance.mjs'

const project = 'xiaowork-homepage-v11-p6e-portability-retry'
const cache = path.resolve('.cache/p6e-backup-portability')
const report = {
  date: new Date().toISOString(),
  project,
  scope: 'Independent new local volumes; original deployment records temporarily unavailable',
  cases: [],
  public: [],
}
const withheld = []
const record = (name, detail) => {
  report.cases.push({ name, detail, result: 'PASS' })
  console.log('PASS ' + name)
}
try {
  localEngine()
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
  const candidates = fs
    .readdirSync('.cache/v11-backups')
    .filter((name) => name.startsWith('p6e-complete-'))
    .sort()
  const backup = path.resolve('.cache/v11-backups', candidates.at(-1))
  const bundle = JSON.parse(fs.readFileSync(path.join(backup, 'bundle.json'), 'utf8'))
  const image = bundle.runtime.images.maintenance
  const verified = verifyBackup(image, backup)
  assert.ok(
    verified.state.administrators === 1 &&
      verified.state.uploads >= 1 &&
      verified.state.releases >= 3,
  )
  report.runtime = bundle.runtime
  report.state = verified.state
  report.fileCount = verified.files.length
  // No restore decision may rely on current.json from the source or the first
  // recovered environment. Move them aside and always restore them in finally.
  for (const original of [
    'xiaowork-homepage-v11-p6e-release-final',
    'xiaowork-homepage-v11-p6e-recovery-final',
  ]) {
    const source = path.resolve('.v11-deploy', original, 'current.json')
    const destination = path.join(cache, original + '-withheld.json')
    fs.renameSync(source, destination)
    withheld.push({ source, destination })
  }
  const restored = restoreProject(project, image, backup)
  assert.deepEqual(restored, verified.state)
  const spec = {
    format: 1,
    source: bundle.runtime.source,
    schema: bundle.runtime.schema,
    images: bundle.runtime.images,
  }
  const specFile = path.join(cache, 'from-backup.json')
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2))
  execFileSync(
    process.execPath,
    [
      'scripts/v11-release.mjs',
      'deploy',
      '--project',
      project,
      '--manifest',
      specFile,
      '--restored',
      '1',
      '--http-port',
      '3221',
      '--https-port',
      '3454',
      '--subnet',
      '192.168.240.0/28',
    ],
    { encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  record(
    'new isolated service reconstructed solely from backup runtime metadata, no original deployment state',
  )
  const baseline = JSON.parse(
    fs.readFileSync('docs/evidence/P6E-backup-recovery.json', 'utf8'),
  ).public.find((item) => item.stage === 'beforeBackup').files
  for (const file of baseline) {
    const response = await fetch('http://127.0.0.1:3221' + file.route, { cache: 'no-store' })
    assert.equal(response.status, 200)
    const actual = createHash('sha256')
      .update(Buffer.from(await response.arrayBuffer()))
      .digest('hex')
    assert.equal(actual, file.sha256)
    report.public.push({ route: file.route, status: response.status, sha256: actual })
  }
  record(
    'independently reconstructed public HTML, SEO, robots, sitemap and active version matched backup baseline',
  )
  const tampered = path.resolve('.cache/v11-backups', 'p6e-tampered-content-' + Date.now())
  // Preserve Linux relative symlinks through Docker Desktop's bind layer. Node's
  // native Windows recursive-copy path crashed on this backup in the first run.
  for (const name of [path.basename(backup), path.basename(tampered)])
    assert.match(name, /^p6e-[a-z0-9-]+$/)
  docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--user',
    '10001:10001',
    '--entrypoint',
    '/bin/sh',
    '--mount',
    `type=bind,src=${path.dirname(backup)},dst=/backup`,
    bundle.runtime.images.gateway,
    '-c',
    `cp -a /backup/${path.basename(backup)} /backup/${path.basename(tampered)}`,
  ])
  const member = verified.files.find(
    (file) => file.path.includes('/public/') && file.path.endsWith('index.html'),
  )
  assert.ok(member)
  fs.appendFileSync(path.join(tampered, 'content', member.path), '\ncorruption-test\n')
  assert.throws(() => verifyBackup(image, tampered), /hash|mismatch|inventory/)
  record('actual restored-publication HTML corruption rejected by complete file inventory')
  const damaged = path.join(cache, 'tampered-runtime')
  fs.mkdirSync(damaged)
  fs.mkdirSync(path.join(damaged, 'content'))
  const changed = structuredClone(bundle)
  changed.runtime.source = '0'.repeat(40)
  fs.writeFileSync(path.join(damaged, 'bundle.json'), JSON.stringify(changed))
  assert.throws(() => verifyBackup(image, damaged), /Runtime descriptor SHA/)
  record('runtime source/image metadata corruption rejected before data restore')
  assert.throws(() => restoreProject(project, image, backup))
  record('existing recovery volumes cannot be overwritten')
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.error = error.message
  console.error(error.message)
  process.exitCode = 1
} finally {
  for (const entry of withheld.reverse()) {
    if (fs.existsSync(entry.destination)) fs.renameSync(entry.destination, entry.source)
  }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(
    'docs/evidence/P6E-backup-portability.json',
    JSON.stringify(report, null, 2) + '\n',
  )
}
