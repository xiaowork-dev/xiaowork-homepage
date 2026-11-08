import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canCreatePublication,
  publicationModeLabel,
  publicationOperable,
  safePreviewURL,
  publicationJobLabel,
  pendingJob,
  isReviewCurrent,
  isActiveReviewCurrent,
} from '../src/lib/publishing.ts'

test('publication actions default closed and require the explicit isolated backend capability', () => {
  const status = {
    enabled: true,
    localOnly: true,
    workerAvailable: true,
    blockingJob: null,
    activeReleaseId: null,
    activeVerified: false,
    storage: { state: 'ok' },
  }
  assert.equal(canCreatePublication(status), true)
  for (const value of [
    null,
    {},
    { ...status, enabled: false },
    { ...status, localOnly: false },
    { ...status, workerAvailable: false },
    { ...status, storage: undefined },
    { ...status, storage: { state: 'critical' } },
    { ...status, storage: { state: 'unknown' } },
    { ...status, blockingJob: { id: 'job_test' } },
    { ...status, blockingJob: undefined },
    { ...status, activeReleaseId: 'rel_a', activeVerified: false },
  ])
    assert.equal(canCreatePublication(value), false)
})

test('production publication is operable only while the server reports an open authorization', () => {
  const production = {
    enabled: true,
    localOnly: false,
    mode: 'production',
    gate: { open: true, code: 'AUTHORIZED', message: '', authorizationId: 'x', expiresAt: null },
    workerAvailable: true,
    blockingJob: null,
    activeReleaseId: null,
    activeVerified: false,
    storage: { state: 'ok' },
  }
  assert.equal(canCreatePublication(production), true)
  assert.equal(publicationModeLabel(production), '生产发布已授权')
  for (const value of [
    { ...production, gate: { ...production.gate, open: false, code: 'GATE_REVOKED' } },
    { ...production, gate: undefined },
    { ...production, mode: 'off' },
    { ...production, mode: undefined },
    { ...production, enabled: false },
  ]) {
    assert.equal(publicationOperable(value), false)
    assert.equal(canCreatePublication(value), false)
    assert.equal(publicationModeLabel(value), '操作未启用')
  }
  assert.equal(publicationModeLabel({ enabled: true, localOnly: true }), '独立本地环境')
})

test('a complete server review must match the exact reviewed workspace before publishing', () => {
  const review = {
    available: true,
    revision: 'ws-7',
    added: [],
    modified: [],
    hidden: [],
    archived: [],
    profileChanged: false,
    settingsChanged: false,
    categoriesChanged: false,
    mediaChanged: false,
  }
  assert.equal(isReviewCurrent(review, 'ws-7'), true)
  for (const value of [
    undefined,
    { ...review, available: false },
    { ...review, revision: 'ws-8' },
    { ...review, categoriesChanged: undefined },
    { ...review, hidden: null },
  ])
    assert.equal(isReviewCurrent(value, 'ws-7'), false)
})
test('preview URLs accept only the exact authenticated same-origin directory', () => {
  const path = '/api/admin/v1/previews/pre_' + 'a'.repeat(32) + '/'
  assert.equal(safePreviewURL(path), path)
  for (const value of [
    'https://example.com' + path,
    '//example.com' + path,
    path + '?token=secret',
    path + '../',
    path + 'index.html',
    '/images/private.png',
    null,
  ])
    assert.equal(safePreviewURL(value), null)
})
test('confirmation remains bound to the reviewed active release, including the initial null', () => {
  const a = 'rel_' + 'a'.repeat(32)
  const b = 'rel_' + 'b'.repeat(32)
  assert.equal(isActiveReviewCurrent(null, { activeReleaseId: null }), true)
  assert.equal(isActiveReviewCurrent(a, { activeReleaseId: a }), true)
  assert.equal(isActiveReviewCurrent(undefined, { activeReleaseId: null }), false)
  assert.equal(isActiveReviewCurrent(a, { activeReleaseId: b }), false)
  assert.equal(isActiveReviewCurrent(null, { activeReleaseId: a }), false)
  assert.equal(isActiveReviewCurrent(a, null), false)
})
test('queued and reconciled results cannot be presented as active publication success', () => {
  assert.equal(pendingJob({ status: 'queued' }), true)
  assert.equal(pendingJob({ status: 'reconciling' }), true)
  assert.match(publicationJobLabel({ status: 'queued', kind: 'publish' }), /尚未生效/)
  assert.match(
    publicationJobLabel({ status: 'succeeded', kind: 'publish', activeVerified: false }),
    /另行核验/,
  )
  assert.match(
    publicationJobLabel({ status: 'succeeded', kind: 'publish', activeVerified: true }),
    /已核验/,
  )
  assert.equal(publicationJobLabel({ status: 'succeeded', kind: 'preview' }), '预览构建完成')
})
