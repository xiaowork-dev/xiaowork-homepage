// This controller reuses reviewed build steps without overwriting 817 evidence.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const source = process.argv[2]
assert.match(source ?? '', /^[a-f0-9]{40}$/)
const cache = path.resolve('.cache/p6e-ro-harness')
fs.mkdirSync(cache, { recursive: true })
const controller = fs
  .readFileSync('scripts/p6e-final-build.mjs', 'utf8')
  .replaceAll('p6e-final-source-', 'p6e-ro-source-')
  .replaceAll('P6E-final-', 'P6E-ro-')
  .replaceAll('p6e-closure-', 'p6e-ro-')
const target = path.join(cache, 'build.mjs')
fs.writeFileSync(target, controller)
execFileSync(process.execPath, [target, source], { stdio: 'inherit', timeout: 3600000 })
