// Explicit offline export of the repository's trusted V1 TS configuration.
// The API imports only validated JSON; it never executes TS/JS or invokes Git.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRevision =
  process.argv[2] ||
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(sourceRevision))
  throw new Error('Expected a full reviewed Git commit SHA.')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    )
  return value
}
const canonical = (value) =>
  JSON.stringify(stable(value)).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
const files = new Map()
async function verifiedFile(relative) {
  const bytes = await readFile(path.join(root, relative))
  const committed = execFileSync('git', ['show', `${sourceRevision}:${relative}`], {
    cwd: root,
    maxBuffer: 4 << 20,
  })
  if (!bytes.equals(committed))
    throw new Error(`Source differs from reviewed revision: ${relative}`)
  files.set(relative, { path: relative, sha256: sha256(bytes), byteSize: bytes.length })
  return bytes
}
const modulePaths = [
  'app/data/site.ts',
  'app/data/about.ts',
  'app/data/project-covers.ts',
  'app/data/projects.ts',
  'shared/seo.ts',
]
const modules = new Map()
for (const relative of modulePaths)
  modules.set(relative, (await verifiedFile(relative)).toString('utf8'))
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  if (!modules.has(relative))
    throw new Error('Exporter dependency is outside the fixed trusted module registry.')
  const exports = {}
  cache.set(relative, exports)
  const require = (specifier) =>
    load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`)))
  const js = ts.transpileModule(modules.get(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const context = vm.createContext(
    { exports, require },
    { codeGeneration: { strings: false, wasm: false } },
  )
  new vm.Script(js, { filename: relative }).runInContext(context, { timeout: 1000 })
  return exports
}
const { siteProfile } = load('app/data/site.ts')
const { aboutProfile } = load('app/data/about.ts')
const { projects, categoryLabels } = load('app/data/projects.ts')
const { pageSeo } = load('shared/seo.ts')
const configText = (await verifiedFile('nuxt.config.ts')).toString('utf8')
const configAST = ts.createSourceFile('nuxt.config.ts', configText, ts.ScriptTarget.Latest, true)
let configObject
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(configAST) === 'defineNuxtConfig')
    configObject = node.arguments[0]
  ts.forEachChild(node, visit)
}
visit(configAST)
const property = (object, name) =>
  object.properties.find((item) => item.name?.getText(configAST).replaceAll("'", '') === name)
    ?.initializer
const head = property(property(configObject, 'app'), 'head')
const siteTitle = property(head, 'title').text
const descriptionMeta = property(head, 'meta').elements.find(
  (item) => property(item, 'name')?.text === 'description',
)
const siteDescription = property(descriptionMeta, 'content').text
const footerSource = (await verifiedFile('app/components/SiteFooter.vue')).toString('utf8')
const footerText = footerSource.match(/<span[^>]*>([^<]+)<\/span>/)?.[1]
if (!footerText) throw new Error('Cannot export the current footer without guessing its text.')
const assets = []
async function asset(id, publicPath, alt) {
  if (
    !/^\/(?:images\/(?:projects\/(?:blog|nav|erp)\/placeholder\.svg|social\/xiaowork-share\.png)|favicon\.svg)$/.test(
      publicPath,
    )
  )
    throw new Error('Asset is outside the fixed repository allowlist.')
  const bytes = await verifiedFile(`public${publicPath}`)
  let width, height, mediaType
  if (publicPath.endsWith('.png')) {
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('Invalid repository PNG.')
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
    mediaType = 'image/png'
  } else {
    const match = bytes.toString('utf8').match(/viewBox=["']0 0 ([\d.]+) ([\d.]+)["']/)
    if (!match) throw new Error('Expected a bounded repository SVG viewBox.')
    width = Number(match[1])
    height = Number(match[2])
    mediaType = 'image/svg+xml'
  }
  assets.push({
    id,
    path: publicPath.slice(1),
    sha256: sha256(bytes),
    mediaType,
    byteSize: bytes.length,
    width,
    height,
    alt,
  })
  return id
}
const exportedProjects = []
for (const project of projects) {
  const coverID = await asset(`builtin-cover-${project.slug}`, project.cover, project.coverAlt)
  if (project.coverSources)
    throw new Error('New source variants need explicit exporter review before import.')
  exportedProjects.push({
    id: project.id,
    order: project.order,
    slug: project.slug,
    name: project.name,
    summary: project.summary,
    description: '',
    category: project.category,
    techStack: [...project.techStack],
    status: project.status,
    featured: project.featured,
    visible: true,
    isPlaceholder: project.isPlaceholder === true,
    cover: { kind: 'builtin', id: coverID },
    coverAlt: project.coverAlt,
    coverKind: project.coverKind,
    demoUrl: project.demoUrl ?? null,
    repositoryUrl: project.repositoryUrl ?? null,
  })
}
const shareID = await asset(
  'builtin-social-share',
  '/images/social/xiaowork-share.png',
  'XiaoWork — Developer & Creator，网站、应用与实用工具',
)
const brandID = await asset('builtin-brand-icon', '/favicon.svg', 'XiaoWork 品牌图标')
const profile = {
  site: { ...siteProfile, avatarAssetId: null, brandAssetId: brandID },
  about: { ...aboutProfile },
}
const settings = {
  siteTitle,
  siteDescription,
  defaultSeoDescription: pageSeo.home.description,
  homeIntroduction: [...siteProfile.introduction],
  footerText,
  defaultShareAssetId: shareID,
  socialLinks: siteProfile.githubUrl
    ? [{ label: 'GitHub · 本站源码', url: siteProfile.githubUrl }]
    : [],
  pages: Object.fromEntries(
    Object.entries(pageSeo).map(([key, value]) => [
      key,
      { title: value.title, description: value.description, shareAssetId: null },
    ]),
  ),
}
const payload = {
  categories: Object.entries(categoryLabels).map(([slug, name], index) => ({
    id: `cat-${slug}`,
    slug,
    name,
    order: index + 1,
  })),
  projects: exportedProjects,
  profile,
  settings,
  assets,
}
const manifest = [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'))
const seed = {
  schemaVersion: 1,
  sourceRevision,
  manifest,
  manifestSha256: sha256(canonical(manifest)),
  payloadSha256: sha256(canonical(payload)),
  payload,
}
await mkdir(path.join(root, 'backend/seed'), { recursive: true })
await writeFile(
  path.join(root, 'backend/seed/v1.json'),
  `${JSON.stringify(stable(seed), null, 2)}\n`,
  'utf8',
)
process.stdout.write(
  `Exported ${exportedProjects.length} unchanged V1 projects; source=${sourceRevision}; manifest=${seed.manifestSha256}\n`,
)
