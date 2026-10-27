import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFileSync, lstatSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'
import { addTemplate } from 'nuxt/kit'
import { normalizeSiteUrl } from './shared/seo'
import {
  parsePublicSnapshot,
  publicationContext,
  publicAsset,
  publicOrigin,
} from './shared/publication'
import type { PublicSnapshot } from './shared/publication'

const snapshotFile = process.env.XIAOWORK_SNAPSHOT_FILE
const publication = snapshotFile
  ? publicationContext(
      process.env.XIAOWORK_RELEASE_ID ?? '',
      process.env.XIAOWORK_PREVIEW_ID ?? '',
      process.env.XIAOWORK_SNAPSHOT_SHA256 ?? '',
    )
  : null
if (
  !snapshotFile &&
  [
    process.env.XIAOWORK_RELEASE_ID,
    process.env.XIAOWORK_PREVIEW_ID,
    process.env.XIAOWORK_SNAPSHOT_SHA256,
  ].some(Boolean)
)
  throw new Error('Publication requires a sealed snapshot')
let snapshot: PublicSnapshot | null = null
if (snapshotFile) {
  if (!isAbsolute(snapshotFile)) throw new Error('Snapshot path must be absolute')
  const stat = lstatSync(snapshotFile)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
    throw new Error('Invalid snapshot file')
  const bytes = readFileSync(snapshotFile)
  if (createHash('sha256').update(bytes).digest('hex') !== publication!.snapshotSha256)
    throw new Error('Snapshot digest mismatch')
  snapshot = parsePublicSnapshot(JSON.parse(bytes.toString('utf8')))
}
const siteUrl = snapshot ? publicOrigin : normalizeSiteUrl(process.env.NUXT_PUBLIC_SITE_URL)
const asset = (path: string) => publicAsset(path, publication)

export default defineNuxtConfig({
  compatibilityDate: '2026-10-25',
  devtools: { enabled: false },
  telemetry: false,
  modules: [
    '@nuxt/eslint',
    (_options, nuxt) => {
      const template = addTemplate({
        filename: 'publication-data.mjs',
        getContents: () =>
          `export const snapshot = ${JSON.stringify(snapshot)};\nexport const publication = ${JSON.stringify(publication)};\n`,
        write: true,
      })
      nuxt.options.alias['#publication-data'] = template.dst
    },
  ],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  typescript: { strict: true },
  experimental: { payloadExtraction: false, appManifest: false },
  runtimeConfig: { public: { siteUrl } },
  hooks: {
    'nitro:config'(config) {
      if (!publication) return
      const publicDir = resolve('public')
      // Nuxt adds the layer public directory again at '/'. The snapshot build
      // serves its assets exclusively from the immutable version prefix.
      config.publicAssets = config.publicAssets?.filter(
        (asset) =>
          !asset?.dir ||
          resolve(asset.dir) !== publicDir ||
          asset.baseURL ===
            (publication.preview ? '/assets/' : `/_releases/${publication.releaseId}/assets/`),
      )
      config.ignore = [...(config.ignore ?? []), '**/README.md']
    },
  },
  app: {
    baseURL: publication?.baseURL ?? '/',
    buildAssetsDir:
      publication && !publication.preview
        ? `/_releases/${publication.releaseId}/_nuxt/`
        : '/_nuxt/',
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: snapshot?.siteSettings.siteTitle ?? 'XiaoWork — 个人品牌与项目展示',
      meta: [
        {
          name: 'description',
          content:
            snapshot?.siteSettings.siteDescription ??
            'XiaoWork 个人品牌主页，展示网站、应用与软件开发项目。',
        },
        { name: 'color-scheme', content: 'dark light' },
        ...(publication
          ? [
              { name: 'xiaowork-release', content: publication.releaseId },
              { name: 'xiaowork-snapshot', content: publication.snapshotSha256 },
            ]
          : []),
        ...(publication?.preview
          ? [{ name: 'robots', content: 'noindex, nofollow, noarchive' }]
          : []),
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: asset('favicon.svg') }],
      script: [{ src: asset('theme-init.js'), tagPosition: 'head', tagPriority: 'critical' }],
    },
  },
  nitro: {
    ...(publication
      ? {
          publicAssets: [
            {
              dir: resolve('public'),
              baseURL: publication.preview
                ? '/assets/'
                : `/_releases/${publication.releaseId}/assets/`,
            },
          ],
        }
      : {}),
    prerender: {
      routes: [
        '/',
        '/projects',
        '/about',
        '/robots.txt',
        ...(publication ? ['/health.json'] : []),
        ...(siteUrl ? ['/sitemap.xml'] : []),
      ],
      crawlLinks: !publication?.preview,
      failOnError: true,
    },
  },
})
