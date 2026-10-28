// Respect ignored private backup ACLs and preserve machine-evidence bytes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import prettier from 'prettier'

const names = [
  ...new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  ),
].sort()
const checked = []
const failed = []
for (const name of names) {
  const info = await prettier.getFileInfo(name, { ignorePath: '.prettierignore' })
  if (info.ignored || !info.inferredParser) continue
  const bytes = fs.readFileSync(name)
  const config = await prettier.resolveConfig(name)
  const passed = await prettier.check(bytes.toString('utf8'), { ...config, filepath: name })
  checked.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex') })
  if (!passed) failed.push(name)
}
const diff = execFileSync('git', ['diff', '--check'], { encoding: 'utf8' })
const output = {
  date: new Date().toISOString(),
  source: '817aa533741bdd5de23f322fa5e5171442cb28a9',
  scope: 'Git-tracked and nonignored files; respect .prettierignore and supported parsers',
  command: 'Prettier API check + git diff --check',
  machineEvidenceFormatted: false,
  privateIgnoredDirectoriesTraversed: false,
  checked,
  failed,
  diffCheck: diff === '' ? 'PASS' : diff,
  result: failed.length === 0 ? 'PASS' : 'FAIL',
}
fs.writeFileSync(
  'docs/evidence/P6E-final-closure-format.json',
  JSON.stringify(output, null, 2) + '\n',
)
console.log(`${output.result}: ${checked.length} files; failures ${JSON.stringify(failed)}`)
assert.equal(failed.length, 0)
