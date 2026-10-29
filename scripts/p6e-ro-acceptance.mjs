// New source group, new projects and evidence; historical results stay intact.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const cache = path.resolve('.cache/p6e-ro-harness')
fs.mkdirSync(cache, { recursive: true })
let controller = fs.readFileSync('scripts/p6e-final-acceptance.mjs', 'utf8')
controller = controller
  .replaceAll('P6E-final-', 'P6E-ro-')
  .replaceAll('p6e-final-harness', 'p6e-ro-harness')
  .replaceAll('p6e-closure-', 'p6e-ro-')
  .replaceAll('3224', '3234')
  .replaceAll('3457', '3477')
  .replaceAll('9335', '9355')
  .replaceAll('3223', '3233')
  .replaceAll('3456', '3476')
  .replaceAll('9334', '9354')
  .replaceAll('192.168.244.', '192.168.238.')
  .replaceAll('192.168.243.', '192.168.237.')
const target = path.join(cache, 'acceptance.mjs')
fs.writeFileSync(target, controller)
execFileSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
  timeout: 1800000,
})
