// Test-only preload for the operator CLI. Never imported by API/Worker images.
// Real Docker remains in use; only the second exact-project writer-stop call
// and the subsequent recovery-record write fail at the host process boundary.
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

const project = 'xiaowork-homepage-v11-p6e-recovery-final'
assert.ok(process.argv.includes('update') && process.argv.includes(project))
assert.equal(path.basename(process.argv[1]), 'v11-release.mjs')
const events = []
const eventFile = path.resolve('.cache/p6e-cli-stop-failure-events.json')
const originalExec = childProcess.execFileSync
const originalOpen = fs.openSync
const originalWrite = fs.writeFileSync
let stops = 0
let records = 0
function record(name) {
  events.push(name)
  originalWrite(eventFile, JSON.stringify(events, null, 2) + '\n')
}
childProcess.execFileSync = function (file, args, options) {
  if (
    file === 'docker' &&
    args.includes(project) &&
    args.includes('compose') &&
    args.includes('stop') &&
    args.includes('worker') &&
    args.includes('api')
  ) {
    stops++
    if (stops === 2) {
      record('host-wrapper rejected second exact-project writer stop; no daemon outage simulated')
      throw Object.assign(new Error('P6E test-only candidate stop failure'), { status: 88 })
    }
  }
  return originalExec.call(this, file, args, options)
}
fs.openSync = function (file, flags, mode) {
  if (
    typeof file === 'string' &&
    file.includes(project) &&
    file.endsWith('recovery-required.json.new')
  ) {
    records++
    if (records === 2) {
      record('host-wrapper returned ENOSPC when updating recovery record; initial intent retained')
      throw Object.assign(new Error('P6E test-only ENOSPC'), { code: 'ENOSPC' })
    }
    record('initial recovery intent write allowed before candidate starts')
  }
  return originalOpen.call(this, file, flags, mode)
}
syncBuiltinESMExports()
