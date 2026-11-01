// Trusted offline operator CLI. Never invoked by an HTTP endpoint.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { docker, localEngine, projectName, tool, volumeNames } from './v11-maintenance.mjs'
import { guardedOperation, evidenceHash, reviewInspection } from './v11-operation.mjs'
export function currentRepair(command, project, image, member, plan, reason, acceptance) {
  projectName(project)
  assert.ok(['inspect', 'apply'].includes(command), 'Use inspect or apply')
  assert.match(image ?? '', /^sha256:[0-9a-f]{64}$/)
  return guardedOperation(project, 'current-' + command, (context) => {
    localEngine()
    const names = volumeNames(project)
    const existing = new Set(docker(['volume', 'ls', '--format', '{{.Name}}']).split(/\s+/))
    for (const name of Object.values(names))
      assert.ok(existing.has(name), 'Refuse implicit creation of missing data volumes')
    for (const id of docker(['ps', '-q']).split(/\s+/).filter(Boolean)) {
      const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', id]))
      assert.ok(
        !mounts.some((m) => Object.values(names).includes(m.Name) && m.RW),
        'A running container has writable access to this project data; stop and investigate it first',
      )
    }
    const sourceMounts = Object.entries(names).flatMap(([role, name]) => [
      '--mount',
      `type=volume,src=${name},dst=/source/${role},readonly,volume-nocopy`,
    ])
    const before = tool(image, 'metadata-readonly', sourceMounts)
    context.record('before', { image, inventory: before, sha256: evidenceHash(before) })
    const mounts =
      command === 'inspect'
        ? sourceMounts
        : [
            ...sourceMounts,
            '--mount',
            `type=volume,src=${names.publications},dst=/mutation/publications,volume-nocopy`,
          ]
    let result, failure
    try {
      result = tool(
        image,
        command === 'inspect' ? 'inspect-current' : 'repair-current',
        mounts,
        command === 'inspect' ? [] : ['-member', member, '-plan-sha256', plan, '-reason', reason],
      )
    } catch (error) {
      failure = error
    }
    const after = tool(image, 'metadata-readonly', sourceMounts)
    context.record('after', { inventory: after, sha256: evidenceHash(after) })
    if (command === 'inspect')
      assert.deepEqual(after, before, 'Source metadata or file SHA256 changed')
    else validateRepairDelta(before, after, member, result)
    if (failure) throw failure
    if (acceptance) acceptance(result, { before, after, context })
    context.record('accepted', {
      result,
      beforeSHA256: evidenceHash(before),
      afterSHA256: evidenceHash(after),
    })
    return result
  })
}
export function reviewCurrentInspection(project, image, markerSHA256, reason) {
  projectName(project)
  assert.match(image ?? '', /^sha256:[0-9a-f]{64}$/)
  return reviewInspection(project, markerSHA256, reason, (before) => {
    assert.equal(before.image, image, 'Use the exact failed inspection image')
    localEngine()
    const names = volumeNames(project)
    for (const id of docker(['ps', '-q']).split(/\s+/).filter(Boolean)) {
      const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', id]))
      assert.ok(
        !mounts.some((m) => Object.values(names).includes(m.Name) && m.RW),
        'A source writer is still running',
      )
    }
    const existing = new Set(docker(['volume', 'ls', '--format', '{{.Name}}']).split(/\s+/))
    for (const name of Object.values(names)) assert.ok(existing.has(name), 'Source volume missing')
    const mounts = Object.entries(names).flatMap(([role, name]) => [
      '--mount',
      `type=volume,src=${name},dst=/source/${role},readonly,volume-nocopy`,
    ])
    const inventory = tool(image, 'metadata-readonly', mounts)
    assert.deepEqual(inventory, before.inventory, 'Original metadata or bytes changed')
    const plan = tool(image, 'inspect-current', mounts)
    assert.deepEqual(
      tool(image, 'metadata-readonly', mounts),
      inventory,
      'Review changed source metadata',
    )
    return { inventory, planSHA256: plan.sha256, state: plan.state }
  })
}
function validateRepairDelta(before, after, member, result) {
  assert.equal(result?.outcome, 'verified-redundant-link-removed', 'Repair result is not verified')
  const removed = 'publications/' + member
  const audit = 'publications/maintenance-repairs'
  assert.match(result.id ?? '', /^repair-[0-9]+$/)
  const additions = new Set([
    `${audit}/${result.id}.intent.json`,
    `${audit}/${result.id}.result.json`,
  ])
  const originals = new Map(before.map((f) => [f.path, f]))
  assert.ok(originals.has(removed), 'Candidate was absent from baseline')
  assert.ok(!after.some((f) => f.path === removed), 'Candidate still exists')
  for (const entry of after) {
    if (additions.has(entry.path)) {
      assert.ok(!originals.has(entry.path), 'Repair audit overwrite')
      continue
    }
    const old = originals.get(entry.path)
    if (entry.path === audit && !old) continue
    assert.ok(old, 'Unplanned new source member')
    if (entry.path === 'publications' || entry.path === audit) {
      const selected = (s) =>
        Object.fromEntries(
          Object.entries(s).filter(([k]) => !['Size', 'Nlink', 'Mtim', 'Ctim'].includes(k)),
        )
      assert.deepEqual(
        selected(entry.stat),
        selected(old.stat),
        'Unexpected publication directory metadata delta',
      )
    } else assert.deepEqual(entry, old, 'Unrelated source metadata or SHA changed during repair')
  }
  for (const entry of before)
    if (entry.path !== removed)
      assert.ok(
        after.some((x) => x.path === entry.path),
        'Unplanned removed source member',
      )
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    console.log(
      JSON.stringify(
        command === 'review' ? reviewCurrentInspection(...args) : currentRepair(command, ...args),
        null,
        2,
      ),
    )
  } catch (error) {
    console.error('V1.1 current repair refused:', error.message)
    process.exitCode = 1
  }
}
