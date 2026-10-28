// Reuse the existing real-browser/fault assertions with an explicit new group.
// Generated controllers remain in .cache; no test hook enters a runtime image.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const mode = process.argv[2]
assert.ok(['admin', 'publishing', 'fault'].includes(mode))
const manifest = JSON.parse(await readFile('docs/evidence/P6E-final-runtime-manifest.json', 'utf8'))
assert.match(manifest.source, /^[a-f0-9]{40}$/)
assert.equal(Object.keys(manifest.images).length, 6)
const cache = path.resolve('.cache/p6e-final-harness')
await mkdir(cache, { recursive: true })
const fault = mode === 'fault'
const originalHelper = fault ? 'p6e-fault-environment.mjs' : 'p6e-browser-environment.mjs'
let helper = await readFile('scripts/' + originalHelper, 'utf8')
const replacements = [
  ['xiaowork-homepage-v11-p6e-e2e', 'xiaowork-homepage-v11-p6e-closure-e2e'],
  ['xiaowork-homepage-v11-p6e-fault', 'xiaowork-homepage-v11-p6e-closure-fault'],
  ['.cache/p6e-browser', '.cache/p6e-closure-browser'],
  ['.cache/p6e-fault', '.cache/p6e-closure-fault'],
  ['3447', '3457'],
  ['3214', '3224'],
  ['9325', '9335'],
  ['3446', '3456'],
  ['3213', '3223'],
  ['9324', '9334'],
  ['192.168.246.', '192.168.244.'],
  ['192.168.248.', '192.168.243.'],
  ['xiaowork-homepage-api:p6e-fault', 'xiaowork-homepage-api:p6e-closure-fault'],
  ['xiaowork-homepage-worker:p6e-fault', 'xiaowork-homepage-worker:p6e-closure-fault'],
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
const helperFile = path.join(cache, originalHelper)
await writeFile(helperFile, helper)
const testFile = fault ? 'p6e-fault-tests.mjs' : mode + '-browser-test.mjs'
let test = await readFile('scripts/' + testFile, 'utf8')
test = test.replaceAll("'./" + originalHelper + "'", JSON.stringify(pathToFileURL(helperFile).href))
test = test
  .replaceAll('P6E-publishing', 'P6E-final-publishing')
  .replaceAll('P6E-admin', 'P6E-final-admin')
  .replaceAll('P6E-faults-', 'P6E-final-faults-')
if (fault) {
  test = test
    .replaceAll('http://127.0.0.1:3213', 'http://127.0.0.1:3223')
    .replaceAll(
      'xiaowork-homepage-fault-data:p6e-test',
      'xiaowork-homepage-fault-data:p6e-closure-test',
    )
    .replaceAll('xiaowork-homepage-worker:p6e-fault', 'xiaowork-homepage-worker:p6e-closure-fault')
  assert.ok(process.argv.length === 4)
}
const generated = path.join(cache, testFile)
await writeFile(generated, test)
execFileSync(process.execPath, [generated, fault ? process.argv[3] : '--p6e'], {
  stdio: 'inherit',
  timeout: 1800000,
})
