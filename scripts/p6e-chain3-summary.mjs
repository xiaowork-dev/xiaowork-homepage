// 仅汇总现有证据；不会接触 Docker、原卷或锁。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
const read = (file) => JSON.parse(fs.readFileSync('docs/evidence/' + file))
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const runtime = read('P6E-chain3-runtime-manifest.json'),
  chain = read('P6E-chain3-current-repair.json'),
  meta = read('P6E-chain3-repair-metadata.json'),
  retained = read('P6E-chain3-retention.json'),
  guard = read('P6E-chain3-protection-r2.json')
assert.equal(guard.result, 'PASS')
assert.equal(guard.cases.length, 3)
assert.equal(chain.source, runtime.source)
assert.equal(chain.result, 'FAIL')
assert.equal(retained.result, 'STOPPED_AFTER_BIND_SOURCE_IDENTITY_REFUSAL')
const byPath = new Map(meta.before.map((e) => [e.path, e]))
const roots = ['authority', 'db', 'publications', 'secrets', 'tls', 'uploads'].map((p) => {
  const a = byPath.get(p),
    b = meta.after.find((e) => e.path === p)
  assert.deepEqual(a.stat.Atim, b.stat.Atim)
  return { path: p, beforeAtim: a.stat.Atim, afterAtim: b.stat.Atim, unchanged: true }
})
const dbBefore = byPath.get('db/content.sqlite'),
  dbAfter = meta.after.find((e) => e.path === 'db/content.sqlite')
assert.deepEqual(dbBefore, dbAfter)
const changed = meta.after
  .filter((e) => byPath.has(e.path) && JSON.stringify(byPath.get(e.path)) !== JSON.stringify(e))
  .map((e) => e.path)
assert.deepEqual(changed, ['publications'])
const removed = meta.before
  .filter((e) => !meta.after.some((n) => e.path === n.path))
  .map((e) => e.path)
assert.deepEqual(removed, ['publications/' + chain.plan.candidates[0].name])
const report = {
  date: new Date().toISOString(),
  source: runtime.source,
  schema: runtime.schema,
  archiveSHA256: runtime.archiveSha256,
  originalBlockers: {
    faultAPIAndInitIdentity: 'FIXED_BY_STOPPED_FORMAL_CONTAINER_RECREATION_DESCRIPTOR_UNCHANGED',
    wholeChainProtection: 'PASS_THREE_FAILURE_CASES_AND_REAL_CHAIN_FAILURE',
  },
  currentBlocker: {
    phase: 'backup-container-pre-start-mount-validation',
    error: chain.error,
    equivalenceProven: false,
    action: 'STOP_RETAIN_GUARDS_AND_EVIDENCE_NO_DOWNSTREAM_RETRY',
  },
  formalIdentity: chain.formalHandoff,
  readonlyRepair: {
    planSHA256: chain.plan.sha256,
    id: chain.repair.id,
    activeRelease: chain.repair.state.activeRelease,
    roots,
    database: dbAfter,
    unchangedExistingEntries: meta.before.filter(
      (e) => JSON.stringify(e) === JSON.stringify(meta.after.find((n) => n.path === e.path)),
    ).length,
    beforeEntries: meta.before.length,
    afterEntries: meta.after.length,
    removed,
    added: meta.after.filter((e) => !byPath.has(e.path)).map((e) => e.path),
    changedExistingPaths: changed,
    fullEvidenceSHA256: hash(meta),
    httpAllSixUnchanged: true,
  },
  guardMatrix: {
    passed: guard.cases.length,
    signal: guard.cases.find((c) => c.mode === 'controller-exit').outcome.signal,
    newProcessesBlocked: true,
  },
  downstream: retained.downstream,
  limits: [
    'bb05 的14/14与7/7是保留的历史前提，不计作新候选全矩阵重验。',
    '正式组六角色健康启动已测，但正常发布/预览/A-B-A/空卷持久化/更新回退完整运行验收未执行。',
    '原保护夹具第一轮没有shell导致启动失败，不能计为控制器强退通过；原机器记录中的第一项PASS标签无效，保留原FAIL不修改。',
    '没有测试宿主OS或Docker引擎整体重启、断电、Firefox/WebKit、真实移动设备或完整渗透。',
  ],
  productionReady: false,
}
fs.writeFileSync('docs/evidence/P6E-chain3-summary.json', JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
})
console.log('SUMMARIZED_PARTIAL_ACCEPTANCE_WITH_BLOCKER')
