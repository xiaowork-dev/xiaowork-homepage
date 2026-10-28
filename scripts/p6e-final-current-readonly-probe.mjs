// Offline test controller only. Copies a stopped test DB from a read-only mount;
// all SQLite diagnostics run on the private copy, never the original volume.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { docker, localEngine } from './v11-maintenance.mjs'

localEngine()
const project = 'xiaowork-homepage-v11-p6e-closure-fault'
const manifest = JSON.parse(fs.readFileSync('docs/evidence/P6E-final-runtime-manifest.json'))
const cache = path.resolve('.cache/p6e-closure-readonly-probe-' + Date.now())
fs.mkdirSync(cache, { recursive: false, mode: 0o700 })
if (process.platform === 'win32')
  execFileSync(
    'icacls',
    [cache, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(OI)(CI)F`],
    { stdio: 'ignore' },
  )
const owned = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
  .split(/\s+/)
  .filter(Boolean)
for (const id of owned) {
  const c = JSON.parse(docker(['inspect', '--format', '{{json .}}', id]))
  if (
    ['api', 'worker', 'api-init', 'publication-init'].includes(
      c.Config.Labels['com.docker.compose.service'],
    )
  )
    assert.equal(c.State.Running, false)
}
const sourceMount = `type=volume,src=${project}_admin-db,dst=/source/db,readonly`
const sourceArgs = [
  'run',
  '--rm',
  '--network',
  'none',
  '--read-only',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges:true',
  '--mount',
  sourceMount,
]
const hash = () =>
  docker([
    ...sourceArgs,
    '--entrypoint',
    '/bin/sh',
    manifest.images.gateway.id,
    '-c',
    'sha256sum /source/db/content.sqlite; ls -ln /source/db',
  ])
const before = hash()
const bytes = execFileSync(
  'docker',
  [
    ...sourceArgs,
    '--entrypoint',
    '/bin/cat',
    manifest.images.gateway.id,
    '/source/db/content.sqlite',
  ],
  { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] },
)
const copy = path.join(cache, 'copy')
fs.mkdirSync(copy, { mode: 0o700 })
fs.writeFileSync(path.join(copy, 'content.sqlite'), bytes, { flag: 'wx', mode: 0o600 })
assert.ok(before.includes(createHash('sha256').update(bytes).digest('hex')))
fs.mkdirSync(path.join(cache, 'backend'))
for (const name of ['go.mod', 'go.sum'])
  fs.copyFileSync(path.join('backend', name), path.join(cache, 'backend', name))
fs.writeFileSync(
  path.join(cache, 'main.go'),
  `package main
import("database/sql";"encoding/json";"os";_ "modernc.org/sqlite")
func main(){ out:=map[string]any{}; for _, mode:= range []string{"ro","immutable"}{ uri:="file:/data/content.sqlite?mode=ro&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"; if mode=="immutable" {uri+="&immutable=1"}; db,err:=sql.Open("sqlite",uri); if err!=nil {out[mode]=map[string]any{"error":err.Error()};continue}; var count int; err=db.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&count); item:=map[string]any{}; if err!=nil {item["error"]=err.Error()} else {item["schemaRows"]=count}; db.Close(); out[mode]=item }; json.NewEncoder(os.Stdout).Encode(out) }
`,
)
const baseEntry = manifest.baseImages.find((value) => value.tag.startsWith('golang:'))
assert.equal(
  docker(['image', 'inspect', '--format', '{{.Id}}', baseEntry.tag]),
  baseEntry.identity.id,
)
const base = baseEntry.tag
fs.writeFileSync(
  path.join(cache, 'Dockerfile'),
  `FROM ${base} AS build\nWORKDIR /src\nCOPY backend/go.mod backend/go.sum ./\nRUN GOPROXY=https://goproxy.cn go mod download\nCOPY main.go ./\nRUN CGO_ENABLED=0 GOPROXY=off GOTOOLCHAIN=local go build -trimpath -o /readonly-probe main.go\nFROM scratch\nCOPY --from=build /readonly-probe /readonly-probe\nUSER 10001:10001\nENTRYPOINT ["/readonly-probe"]\n`,
)
const tag = 'xiaowork-homepage-current-readonly-probe:p6e-test'
const build = execFileSync('docker', ['build', '--network=default', '-t', tag, cache], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 360000,
})
fs.writeFileSync(path.join(cache, 'build.txt'), build, { mode: 0o600 })
const probe = (readonly) =>
  JSON.parse(
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
      '--mount',
      `type=bind,src=${copy},dst=/data${readonly ? ',readonly' : ''}`,
      tag,
    ]),
  )
const readOnlyCopy = probe(true)
const writableCopy = probe(false)
const after = hash()
assert.equal(after, before)
assert.ok(readOnlyCopy.ro.error)
assert.equal(readOnlyCopy.immutable.schemaRows, 3)
assert.equal(writableCopy.ro.schemaRows, 3)
const report = {
  date: new Date().toISOString(),
  source: manifest.source,
  project,
  maintenance: manifest.images.maintenance.id,
  diagnosticImage: docker(['image', 'inspect', '--format', '{{.Id}}', tag]),
  sourceMount: 'readonly',
  originalWritersStopped: true,
  originalHasWALOrSHM: /content\.sqlite-(wal|shm)/.test(before),
  originalBytes: bytes.length,
  originalSHA256: createHash('sha256').update(bytes).digest('hex'),
  originalMetadataUnchanged: before === after,
  originalDBWriteMountUsed: false,
  readOnlyCopy,
  writableCopy,
  explanation:
    'The exact offline SQLite module cannot query a clean WAL-mode DB on a fully read-only directory without WAL/SHM. Immutable offline-copy query and ordinary read-only connection on a writable COPY succeed. The frozen maintenance CLI masks the raw SELECT error as schema uninitialized. No original DB checkpoint, pointer mutation or runtime fix was performed.',
  result: 'REPRODUCED_BLOCKER',
}
fs.writeFileSync(
  'docs/evidence/P6E-final-current-readonly-probe.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log(JSON.stringify(report, null, 2))
