// Pattern scan only the current public artifact of the named final isolated stack.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { localEngine, projectName } from './v11-maintenance.mjs'
const run = promisify(execFile)
const [manifestPath, project] = process.argv.slice(2)
projectName(project)
assert.ok(project.startsWith('xiaowork-homepage-v11-p6e-closure-'))
const spec = JSON.parse(await readFile(manifestPath, 'utf8'))
localEngine()
const docker = async (...args) =>
  (
    await run('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 << 20 })
  ).stdout.trim()
const worker = await docker(
  'ps',
  '-q',
  '--filter',
  `label=com.docker.compose.project=${project}`,
  '--filter',
  'label=com.docker.compose.service=worker',
)
assert.match(worker, /^[a-f0-9]+$/)
const workerImage = await docker('inspect', '--format', '{{.Image}}', worker)
assert.equal(workerImage, spec.images.worker.id ?? spec.images.worker)
const publicManifest = `const f=require('node:fs'),p=require('node:path'),c=require('node:crypto');const root='/publications/current/public';const files=[];function walk(d){for(const n of f.readdirSync(d).sort()){const v=p.join(d,n),s=f.lstatSync(v);if(s.isDirectory())walk(v);else{if(!s.isFile()||s.isSymbolicLink())throw Error('unexpected public file');const b=f.readFileSync(v);files.push({name:p.relative(root,v),bytes:b.length,sha256:c.createHash('sha256').update(b).digest('hex')})}}}walk(root);console.log(JSON.stringify({current:JSON.parse(f.readFileSync(root+'/__xiaowork-release.json','utf8')),files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),manifestSha256:c.createHash('sha256').update(JSON.stringify(files)).digest('hex')}))`
const before = JSON.parse(await docker('exec', worker, '/usr/local/bin/node', '-e', publicManifest))
assert.ok(before.current.releaseId?.startsWith('rel_'))
const scannerTag = 'zricethezav/gitleaks:v8.28.0'
const scannerImage = await docker('image', 'inspect', '--format', '{{.Id}}', scannerTag)
assert.match(scannerImage, /^sha256:[a-f0-9]{64}$/)
const directory = path.resolve('.cache/p6e-final-secret-scan', Date.now().toString())
await mkdir(directory, { recursive: true })
const args = [
  'run',
  '--rm',
  '--pull',
  'never',
  '--network',
  'none',
  '--read-only',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges:true',
  '--user',
  '10001:10001',
  '--tmpfs',
  '/tmp:size=32m,mode=1777',
  '--mount',
  `type=volume,src=${project}_admin-publications,dst=/publications,readonly`,
  '--mount',
  `type=bind,src=${directory},dst=/report`,
  scannerImage,
  'dir',
  '/publications/current/public',
  '--no-banner',
  '--redact',
  '--log-level',
  'warn',
  '--report-format',
  'json',
  '--report-path',
  '/report/findings.json',
]
let scanExit = 0
try {
  await docker(...args)
} catch (error) {
  assert.equal(typeof error.code, 'number')
  scanExit = error.code
}
const rawBytes = await readFile(path.join(directory, 'findings.json'))
const findings = JSON.parse(rawBytes)
const after = JSON.parse(await docker('exec', worker, '/usr/local/bin/node', '-e', publicManifest))
assert.deepEqual(after, before, 'Active public bytes changed during secret scanning')
assert.equal(await docker('inspect', '--format', '{{.Image}}', worker), workerImage)
const report = {
  date: new Date().toISOString(),
  source: spec.source,
  project,
  scope:
    'Only current/public in the named final isolated publications volume; no DB, uploads, previews or backup content exported',
  current: before.current,
  files: before.files,
  bytes: before.bytes,
  publicManifestSha256: before.manifestSha256,
  scanner: { tag: scannerTag, imageId: scannerImage, version: '8.28.0' },
  workerImage,
  execution: {
    network: 'none',
    user: '10001:10001',
    readOnlyRootfs: true,
    publicationMountReadOnly: true,
    capabilitiesDropped: 'ALL',
    noNewPrivileges: true,
    scanExit,
  },
  rawReportSha256: createHash('sha256').update(rawBytes).digest('hex'),
  findings: findings.map(({ RuleID, File, StartLine, EndLine }) => ({
    rule: RuleID,
    file: File,
    startLine: StartLine,
    endLine: EndLine,
  })),
  result: scanExit === 0 && findings.length === 0 ? 'NO_KNOWN_SECRETS_FOUND' : 'REVIEW_REQUIRED',
  limitations: [
    'Pattern scan is not proof that unknown secrets do not exist.',
    'Only the recorded active artifact is scanned; final repository sources and security logic have separate checks.',
  ],
}
await writeFile(
  'docs/evidence/P6E-final-public-secret-scan.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    result: report.result,
    files: report.files,
    bytes: report.bytes,
    findings: findings.length,
  }),
)
if (report.result !== 'NO_KNOWN_SECRETS_FOUND') process.exitCode = 1
