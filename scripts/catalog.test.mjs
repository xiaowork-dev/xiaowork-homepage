import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterProjects, parseCatalogQuery } from '../app/utils/project-catalog.ts'
import { normalizeSiteUrl } from '../shared/seo.ts'

const fixtures = [
  {
    id: 'b',
    name: 'Beta 10',
    summary: '网站实践',
    techStack: ['Nuxt'],
    category: 'website',
    featured: false,
    order: 1,
  },
  {
    id: 'a',
    name: 'Alpha',
    summary: '企业管理',
    techStack: ['Java'],
    category: 'application',
    featured: true,
    order: 2,
  },
  {
    id: 'c',
    name: 'Beta 2',
    summary: '网站学习',
    techStack: ['Vue'],
    category: 'website',
    featured: true,
    order: 3,
  },
]
const select = (query) => filterProjects(fixtures, parseCatalogQuery(query)).map((p) => p.id)

test('combined filters match terms across name, summary and stack without mutating source', () => {
  assert.deepEqual(select({ category: 'website', q: 'BETA Nuxt' }), ['b'])
  assert.deepEqual(select({ q: '企业' }), ['a'])
  assert.deepEqual(select({ q: '[.*]' }), [])
  assert.deepEqual(select({ category: 'open-source' }), [])
  assert.deepEqual(
    fixtures.map((p) => p.id),
    ['b', 'a', 'c'],
  )
})

test('sorts respect recommendation, featured priority and natural names', () => {
  assert.deepEqual(select({}), ['b', 'a', 'c'])
  assert.deepEqual(select({ sort: 'featured' }), ['a', 'c', 'b'])
  assert.deepEqual(select({ sort: 'name-asc' }), ['a', 'c', 'b'])
  assert.deepEqual(select({ sort: 'name-desc' }), ['b', 'c', 'a'])
})

test('query input rejects unknown and repeated parameters; search is bounded', () => {
  assert.deepEqual(parseCatalogQuery({ category: ['website'], sort: ['featured'], q: ['Nuxt'] }), {
    category: 'all',
    sort: 'recommended',
    search: '',
  })
  assert.equal(parseCatalogQuery({ q: 'a'.repeat(200) }).search.length, 100)
  assert.deepEqual(select({ category: 'unknown', sort: 'unknown' }), ['b', 'a', 'c'])
})

test('SEO origin accepts empty and loopback but rejects unsafe public origins', () => {
  assert.equal(normalizeSiteUrl(''), '')
  assert.equal(normalizeSiteUrl('http://127.0.0.1:3103'), 'http://127.0.0.1:3103')
  for (const input of [
    'http://example.test',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test?q=1',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => normalizeSiteUrl(input))
  }
})
