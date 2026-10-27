import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  parsePublicSnapshot,
  publicationContext,
  publicAsset,
  resolvePublicAsset,
} from '../shared/publication.ts'

const seed = JSON.parse(readFileSync(new URL('../backend/seed/v1.json', import.meta.url))).payload
const fixture = () => ({
  schemaVersion: 1,
  snapshotId: 'snap_' + 'a'.repeat(32),
  workspaceRevision: 'ws-12',
  createdAt: '2026-10-27T00:00:00Z',
  siteProfile: structuredClone(seed.profile.site),
  aboutProfile: structuredClone(seed.profile.about),
  siteSettings: structuredClone(seed.settings),
  visibleProjects: structuredClone(seed.projects),
  categories: seed.categories.map(({ slug, name, order }) => ({ slug, name, order })),
  mediaManifest: [],
  legacyAssetAllowlist: seed.assets.map((asset) => asset.id),
})
const release = publicationContext('rel_' + 'b'.repeat(32), '', 'c'.repeat(64))

test('public snapshot accepts sealed public content and binds builtin assets to immutable release URLs', () => {
  const snapshot = parsePublicSnapshot(fixture())
  assert.equal(snapshot.visibleProjects.length, 3)
  assert.equal(
    resolvePublicAsset('builtin-cover-blog', snapshot, release),
    `/_releases/${release.releaseId}/assets/images/projects/blog/placeholder.svg`,
  )
  assert.equal(publicAsset('theme-init.js', null), '/theme-init.js')
})

test('private, hidden and unreferenced fields are rejected before client serialization', () => {
  const mutations = [
    (value) => {
      value.password = 'never-public'
    },
    (value) => {
      value.siteProfile.csrfToken = 'never-public'
    },
    (value) => {
      value.visibleProjects[0].archivedAt = '2026-10-27T00:00:00Z'
    },
    (value) => {
      value.visibleProjects[0].visible = false
    },
    (value) => {
      value.visibleProjects[0].cover.id = 'unknown-builtin'
    },
    (value) => {
      value.siteSettings.pages.home.title = '<script>alert(1)</script>'
    },
    (value) => {
      value.aboutProfile.contacts[0].url = 'https://127.0.0.1/admin'
    },
    (value) => {
      value.legacyAssetAllowlist.push('__proto__')
    },
  ]
  for (const mutate of mutations) {
    const value = fixture()
    mutate(value)
    assert.throws(() => parsePublicSnapshot(value))
  }
})

test('media manifests allow only derived hash paths and reject private metadata or traversal', () => {
  const value = fixture()
  const media = {
    id: 'med_' + 'd'.repeat(32),
    sha256: 'e'.repeat(64),
    mediaType: 'image/png',
    byteSize: 123,
    width: 960,
    height: 600,
    alt: '公开图片',
    path: 'media/' + 'e'.repeat(64) + '.png',
  }
  value.mediaManifest.push(media)
  value.visibleProjects[0].cover = { kind: 'media', id: media.id }
  assert.equal(
    resolvePublicAsset(media.id, parsePublicSnapshot(value), release),
    `/_releases/${release.releaseId}/assets/${media.path}`,
  )
  for (const path of ['../private.png', '/uploads/image.png', 'media/' + 'f'.repeat(64) + '.png']) {
    const invalid = structuredClone(value)
    invalid.mediaManifest[0].path = path
    assert.throws(() => parsePublicSnapshot(invalid))
  }
  value.mediaManifest[0].publicConfirmationNote = 'private verification note'
  assert.throws(() => parsePublicSnapshot(value))
})

test('preview assets remain under exact authenticated base and IDs cannot inject routes', () => {
  const id = 'pre_' + 'f'.repeat(32)
  const preview = publicationContext(id, id, 'a'.repeat(64))
  assert.equal(preview.baseURL, `/api/admin/v1/previews/${id}/`)
  assert.equal(publicAsset('favicon.svg', preview), `${preview.baseURL}assets/favicon.svg`)
  for (const path of [
    '../favicon.svg',
    '/favicon.svg',
    'api/admin/v1/media/secret/content',
    'images/%2e%2e/private.png',
  ])
    assert.throws(() => publicAsset(path, preview))
  assert.throws(() => publicationContext('rel_../private', '', 'a'.repeat(64)))
  assert.throws(() => publicationContext(id, '', 'a'.repeat(64)))
  assert.throws(() => publicationContext(release.releaseId, id, 'a'.repeat(64)))
})
