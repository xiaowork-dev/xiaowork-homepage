// Reuse the existing real-browser/fault assertions with an explicit new group.
// Generated controllers remain in .cache; no test hook enters a runtime image.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const mode = process.argv[2]
if (mode === 'fault')
  assert.ok(
    !existsSync(`docs/evidence/P6E-chain3-faults-${process.argv[3]}.json`),
    'Preserve existing fault evidence',
  )
assert.ok(
  ['admin', 'publishing', 'fault', 'prepare', 'performance', 'security-http'].includes(mode),
)
const manifest = JSON.parse(
  await readFile('docs/evidence/P6E-chain3-runtime-manifest.json', 'utf8'),
)
assert.match(manifest.source, /^[a-f0-9]{40}$/)
assert.equal(Object.keys(manifest.images).length, 6)
const cache = path.resolve('.cache/p6e-chain3-harness')
await mkdir(cache, { recursive: true })
if (['performance', 'security-http'].includes(mode)) {
  let controller = await readFile(`scripts/p6e-${mode}.mjs`, 'utf8')
  controller = controller
    .replaceAll('127.0.0.1:3214', '127.0.0.1:3274')
    .replaceAll('3447', '3524')
    .replaceAll('.cache/p6e-browser/', '.cache/p6e-chain3-browser/')
    .replaceAll('P6E-', 'P6E-chain3-')
  const generated = path.join(cache, mode + '.mjs')
  await writeFile(generated, controller)
  execFileSync(process.execPath, [generated], { stdio: 'inherit', timeout: 600000 })
  process.exit(0)
}
const fault = mode === 'fault' || mode === 'prepare'
const originalHelper = fault ? 'p6e-fault-environment.mjs' : 'p6e-browser-environment.mjs'
let helper = await readFile('scripts/' + originalHelper, 'utf8')
const replacements = [
  ['xiaowork-homepage-v11-p6e-e2e', 'xiaowork-homepage-v11-p6e-chain3-e2e'],
  ['xiaowork-homepage-v11-p6e-fault', 'xiaowork-homepage-v11-p6e-chain3-fault'],
  ['.cache/p6e-browser', '.cache/p6e-chain3-browser'],
  ['.cache/p6e-fault', '.cache/p6e-chain3-fault'],
  ['3447', '3524'],
  ['3214', '3274'],
  ['9325', '9395'],
  ['3446', '3523'],
  ['3213', '3273'],
  ['9324', '9394'],
  ['192.168.246.', '192.168.220.'],
  ['192.168.248.', '192.168.221.'],
  ['xiaowork-homepage-api:p6e-fault', 'xiaowork-homepage-api:p6e-chain3-fault'],
  ['xiaowork-homepage-worker:p6e-fault', 'xiaowork-homepage-worker:p6e-chain3-fault'],
  ['xiaowork-homepage-worker:p6d-dev', manifest.images.worker.id],
]
for (const [before, after] of replacements) helper = helper.replaceAll(before, after)
// The base Compose must use the final IDs for every role, including init roles.
const roleTags = {
  api: 'xiaowork-homepage-api:p6d-dev',
  worker: 'xiaowork-homepage-worker:p6d-dev',
  gateway: 'xiaowork-homepage-admin-gateway:p6d-dev',
  frontend: 'xiaowork-homepage:p6d-legacy',
  static: 'xiaowork-homepage-publication-static:p6e-dev',
}
const imageReplace = Object.entries(roleTags)
  .map(
    ([role, tag]) =>
      `.replaceAll(${JSON.stringify(tag)}, ${JSON.stringify(manifest.images[role].id)})`,
  )
  .join('\n')
if (fault) {
  helper = helper.replace(
    "const base = (await readFile('compose.admin-publish.yaml', 'utf8'))",
    "const base = (await readFile('compose.admin-publish.yaml', 'utf8'))\n" + imageReplace,
  )
} else {
  helper = helper.replace(
    "    'compose.admin-publish.yaml',",
    "    path.join(cache, 'compose.base.yaml'),",
  )
  helper = helper.replace(
    "  const nginx = await readFile('deploy/admin-publish/nginx.conf', 'utf8')",
    "  await writeFile(path.join(cache, 'compose.base.yaml'), (await readFile('compose.admin-publish.yaml', 'utf8'))\n" +
      imageReplace +
      ")\n  const nginx = await readFile('deploy/admin-publish/nginx.conf', 'utf8')",
  )
}
// Generated base lives in .cache; bind paths must still resolve at repo root.
helper = helper.replace(
  "    '-p',\n    project,",
  "    '-p',\n    project,\n    '--project-directory',\n    process.cwd(),",
)
// Fault helper already sets project-directory; a duplicate identical option is harmless but avoid it.
helper = helper.replace(
  "    '--project-directory',\n    process.cwd(),\n    '--project-directory',\n    process.cwd(),",
  "    '--project-directory',\n    process.cwd(),",
)
if (fault) {
  const formalOverride = `services:
  api:
    image: ${manifest.images.api.id}
  worker:
    image: ${manifest.images.worker.id}
    command: !override ["-socket", "/run/publishing/publisher.sock", "-root", "/publications", "-source-revision", "${manifest.source}", "-builder-id", "${manifest.images.worker.id}"]
  gateway:
    volumes:
      - ./.cache/p6e-chain3-fault/nginx.conf:/etc/nginx/nginx.conf:ro
    ports: !override
      - '127.0.0.1:3273:8080'
      - '127.0.0.1:3523:3523'
      - '127.0.0.1:9394:9323'
`
  helper = helper.replace(
    '  assert.ok(\n    [',
    '  if (process.env.CHAIN3_OFFICIAL === "1") { await writeFile(path.join(cache, "compose.override.yaml"), ' +
      JSON.stringify(formalOverride) +
      '); return }\n  assert.ok(\n    [',
  )
  helper = helper.replace('const builder = cli(', 'let builder = cli(')
  helper = helper.replace(
    '  assert.match(source,',
    '  if (process.env.CHAIN3_OFFICIAL === "1") builder = ' +
      JSON.stringify(manifest.images.worker.id) +
      '\n  assert.match(source,',
  )
}
const helperFile = path.join(cache, originalHelper)
await writeFile(helperFile, helper)
if (mode === 'prepare') process.exit(0)
const testFile = fault ? 'p6e-fault-tests.mjs' : mode + '-browser-test.mjs'
let test = await readFile('scripts/' + testFile, 'utf8')
test = test.replaceAll("'./" + originalHelper + "'", JSON.stringify(pathToFileURL(helperFile).href))
test = test
  .replaceAll('P6E-publishing', 'P6E-chain3-publishing')
  .replaceAll('P6E-admin', 'P6E-chain3-admin')
  .replaceAll('P6E-faults-', 'P6E-chain3-faults-')
if (fault) {
  // The final API includes the diagnostic cleanup fix: require the stronger
  // real SQLite/audit assertions that historical baseline runs did not enable.
  test = test.replace(
    'if (postfixApi) {\n      assert.equal(job.error',
    "if (postfixApi || name === 'recovery-fails') {\n      assert.equal(job.error",
  )
  test = test
    .replaceAll('http://127.0.0.1:3213', 'http://127.0.0.1:3273')
    .replaceAll(
      'xiaowork-homepage-fault-data:p6e-test',
      'xiaowork-homepage-fault-data:p6e-chain3-test',
    )
    .replaceAll('xiaowork-homepage-worker:p6e-fault', 'xiaowork-homepage-worker:p6e-chain3-fault')
  assert.ok(process.argv.length === 4)
}
const generated = path.join(cache, testFile)
await writeFile(generated, test)
execFileSync(process.execPath, [generated, fault ? process.argv[3] : '--p6e'], {
  stdio: 'inherit',
  timeout: 1800000,
})
