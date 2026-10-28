// Real HTTPS/UI acceptance of the isolated P6-D publication pipeline.
// Evidence contains response metadata only; credentials and session material stay in memory.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
const p6e = process.argv[2] === '--p6e'
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && p6e))
const evidenceName = (name) => (p6e ? name.replace(/^P6D/, 'P6E-publishing') : name)
const {
  expireSession,
  initializeTestAdministrator,
  origin,
  prepareEnvironment,
  project,
  recreateEnvironment,
  startBrowserContainer,
  stopBrowserContainer,
} = await import(p6e ? './p6e-browser-environment.mjs' : './publishing-browser-environment.mjs')

const requireAdmin = createRequire(path.resolve('admin/package.json'))
const { chromium } = requireAdmin('playwright-core')
const evidence = path.resolve('docs/evidence')
await mkdir(evidence, { recursive: true })
const report = {
  date: new Date().toISOString(),
  project,
  origin,
  scope: 'Dedicated local HTTPS Docker volumes only; no production connection',
  tlsVerificationDisabled: false,
  hostCertificateStoreModified: false,
  cases: [],
  http: [],
  resources: [],
  consoleErrors: [],
  responsive: [],
}
const api = '/api/admin/v1'
const marker = randomBytes(4).toString('hex')
let browser, context, page, credentials
let currentStep = 'prepare isolated environment'
let allowDialog = false
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function record(name, detail = '') {
  report.cases.push({ name, result: 'PASS', detail })
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`)
}
function observe(p, label = 'admin') {
  p.setDefaultTimeout(20000)
  p.setDefaultNavigationTimeout(30000)
  p.on('dialog', (dialog) => (allowDialog ? dialog.accept() : dialog.dismiss()))
  p.on('pageerror', (error) =>
    report.consoleErrors.push({ page: label, kind: 'pageerror', message: error.message }),
  )
  p.on('console', (msg) => {
    if (/hydration|mismatch|content security policy|refused to|uncaught/i.test(msg.text()))
      report.consoleErrors.push({ page: label, kind: msg.type(), message: msg.text() })
  })
  p.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin !== origin) return
    const item = {
      page: label,
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
    }
    report.http.push(item)
    if (['script', 'stylesheet', 'image'].includes(response.request().resourceType()))
      report.resources.push({ ...item, type: response.request().resourceType() })
  })
}
async function screenshot(name, p = page) {
  // A screenshot must never include a populated password control.
  assert.equal(
    await p
      .locator('input[type="password"]')
      .evaluateAll((items) => items.some((item) => item.value)),
    false,
  )
  await p.evaluate(() => window.scrollTo(0, 0))
  await p.screenshot({
    path: path.join(evidence, evidenceName(name)),
    fullPage: true,
    animations: 'disabled',
  })
}
async function secret(locator, value) {
  try {
    await locator.fill(value)
  } catch {
    throw new Error('Secure password input failed; value omitted')
  }
}
async function uiRequest(pathname, method, status, button, p = page) {
  const pending = p.waitForResponse(
    (r) => new URL(r.url()).pathname === api + pathname && r.request().method() === method,
  )
  await button.click()
  const response = await pending
  assert.equal(response.status(), status, `${method} ${pathname}`)
  return status === 204 ? null : (await response.json()).data
}
async function login(p) {
  await p.goto(origin + '/admin/login')
  await p.getByRole('main').getByLabel('管理员账户', { exact: true }).fill(credentials.username)
  await secret(p.locator('main input[name="password"]'), credentials.password)
  await uiRequest('/auth/login', 'POST', 200, p.getByRole('button', { name: '安全登录' }), p)
  await p.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
}
async function read(pathname, p = page) {
  return await p.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error('Authenticated test read rejected: ' + response.status)
    return (await response.json()).data
  }, api + pathname)
}
async function enabled(locator) {
  await locator.waitFor()
  const deadline = Date.now() + 30000
  while (await locator.isDisabled()) {
    if (Date.now() > deadline) throw new Error('Expected publication control remained disabled')
    await pause(200)
  }
}
async function refresh() {
  const button = page.getByRole('button', { name: '重新读取草稿与发布状态', exact: true })
  await enabled(button)
  await button.click()
  await enabled(page.getByRole('button', { name: '构建私有预览', exact: true }))
}
async function reauth() {
  await secret(page.getByLabel('当前密码', { exact: true }), credentials.password)
  await uiRequest(
    '/auth/reauth',
    'POST',
    200,
    page.getByRole('button', { name: '验证当前密码', exact: true }),
  )
  assert.equal(await page.getByLabel('当前密码', { exact: true }).inputValue(), '')
}
async function waitJob(id, kind) {
  assert.match(id, /^job_[a-f0-9]{32}$/)
  const deadline = Date.now() + 360000
  while (Date.now() < deadline) {
    const { job } = await read('/jobs/' + id)
    if (job.status === 'succeeded') {
      assert.equal(job.kind, kind)
      if (kind !== 'preview') {
        const status = await read('/publishing-status')
        assert.equal(status.activeVerified, true)
        assert.equal(status.activeReleaseId, job.releaseId)
      }
      // Let the real UI poll the terminal state, then re-read its actual history.
      await pause(2800)
      await refresh()
      await page.locator('code').filter({ hasText: job.releaseId }).first().waitFor()
      return job
    }
    if (!['queued', 'running', 'reconciling'].includes(job.status))
      throw new Error(
        `Publication task ${kind} ended ${job.status}: ${job.error?.code ?? 'no code'}`,
      )
    await pause(2000)
  }
  throw new Error('Isolated publication task timed out')
}
async function create(kind) {
  await refresh()
  if (kind !== 'preview') await reauth()
  if (kind === 'publish')
    await page
      .getByLabel('我已核对上述全站变化；发布整个草稿版本到本地静态站，不会连接正式服务器。', {
        exact: true,
      })
      .check()
  const name = kind === 'preview' ? '构建私有预览' : '确认全站本地发布'
  const button = page.getByRole('button', { name, exact: true })
  await enabled(button)
  const queued = await uiRequest('/' + kind + '-jobs', 'POST', 202, button)
  assert.equal(queued.status, 'queued')
  return await waitJob(queued.jobId, kind)
}
async function saveDraft(version) {
  // Only seed content in the dedicated test database is changed. All writes use
  // the live session/CSRF, current revision and a fresh explicit idempotency key.
  return await page.evaluate(
    async ({ version, marker }) => {
      const base = '/api/admin/v1'
      const get = async (route) => {
        const response = await fetch(base + route, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Draft fixture read failed: ' + response.status)
        return (await response.json()).data
      }
      const session = await get('/auth/session')
      let workspace = await get('/workspace')
      const put = async (route, body, method = 'PUT') => {
        const response = await fetch(base + route, {
          method,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': session.csrfToken,
            'If-Match': '"' + workspace.revision + '"',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error('Draft fixture write failed: ' + response.status)
        const result = (await response.json()).data
        workspace = await get('/workspace')
        return result
      }
      const brand = `XiaoWork ${version} ${marker}`
      const project = workspace.projects.find((item) => item.visible && !item.archivedAt)
      if (!project || !workspace.profile || !workspace.settings)
        throw new Error('Seed workspace incomplete')
      const canvas = document.createElement('canvas')
      canvas.width = 960
      canvas.height = 600
      const graphics = canvas.getContext('2d')
      if (!graphics) throw new Error('Canvas fixture unavailable')
      graphics.fillStyle = version === 'A' ? '#33234c' : '#243d4d'
      graphics.fillRect(0, 0, canvas.width, canvas.height)
      graphics.fillStyle = '#fff8ed'
      graphics.font = 'bold 44px sans-serif'
      graphics.fillText('P6D test fixture', 50, 210)
      graphics.font = '32px sans-serif'
      graphics.fillText(`Snapshot ${version} / ${marker}`, 50, 280)
      graphics.font = '28px sans-serif'
      graphics.fillText('Synthetic image; not a project screenshot', 50, 350)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Canvas fixture encoding failed')
      const multipart = new FormData()
      multipart.append('file', blob, `p6d-fixture-${version}-${marker}.png`)
      const uploaded = await fetch(base + '/media', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-CSRF-Token': session.csrfToken, 'If-Match': '"' + workspace.revision + '"' },
        body: multipart,
      })
      if (uploaded.status !== 201)
        throw new Error('Synthetic fixture upload failed: ' + uploaded.status)
      const { media } = (await uploaded.json()).data
      workspace = await get('/workspace')
      await put(
        '/media/' + media.id,
        {
          displayName: `P6D synthetic fixture ${version} ${marker}`,
          alt: `P6D synthetic test fixture ${version}; not a project screenshot`,
          publicUseConfirmed: true,
          publicConfirmationNote:
            'Locally drawn canvas test fixture; no personal, customer or business data; explicitly not a real project screenshot.',
        },
        'PATCH',
      )
      const fields = [
        'slug',
        'name',
        'summary',
        'description',
        'category',
        'techStack',
        'status',
        'featured',
        'visible',
        'isPlaceholder',
        'cover',
        'coverAlt',
        'coverKind',
        'demoUrl',
        'repositoryUrl',
      ]
      const projectInput = Object.fromEntries(fields.map((field) => [field, project[field]]))
      projectInput.name = `Publication ${version} ${marker}`
      projectInput.featured = true
      projectInput.cover = { kind: 'media', id: media.id }
      projectInput.coverAlt = `P6D synthetic test fixture ${version}; not a project screenshot`
      projectInput.coverKind = 'placeholder'
      projectInput.isPlaceholder = true
      projectInput.summary = `Isolated local ${version} snapshot ${marker}; project facts remain unconfirmed.`
      await put('/projects/' + project.id, projectInput)
      const profile = structuredClone(workspace.profile)
      profile.site.name = brand
      profile.site.introduction = [`Isolated ${version} profile ${marker}.`]
      profile.about.brandIntroduction = `Isolated ${version} about ${marker}.`
      await put('/profile', profile)
      const settings = structuredClone(workspace.settings)
      settings.homeIntroduction = [`Isolated ${version} homepage ${marker}.`]
      for (const key of ['home', 'projects', 'about']) {
        settings.pages[key].title = `${brand} ${key}`
        settings.pages[key].description = `Isolated ${version} ${key} description ${marker}.`
      }
      await put('/settings', settings)
      return {
        brand,
        projectName: projectInput.name,
        revision: workspace.revision,
        media: { id: media.id, sha256: media.sha256, path: 'media/' + media.sha256 + '.png' },
      }
    },
    { version, marker },
  )
}
async function verifyPublic(p, content, releaseId, route) {
  const expectedTitle = `${content.brand} ${route === '/' ? 'home' : route.replaceAll('/', '')}`
  // Nuxt client navigation does not create a new document load event. Wait
  // for its route and head update, rather than asserting against the old h1.
  await p.waitForURL((url) => url.pathname.replace(/\/$/, '') === route.replace(/\/$/, ''))
  await p.waitForFunction((title) => document.title === title, expectedTitle)
  await p.locator('h1').waitFor()
  await p.waitForLoadState('networkidle')
  assert.ok((await p.locator('body').innerText()).includes(content.brand))
  assert.equal(await p.title(), expectedTitle)
  assert.equal(
    await p.locator('meta[name="description"]').getAttribute('content'),
    `Isolated ${content.brand.includes(' B ') ? 'B' : 'A'} ${route === '/' ? 'home' : route.replaceAll('/', '')} description ${marker}.`,
  )
  assert.equal(await p.locator('meta[name="xiaowork-release"]').getAttribute('content'), releaseId)
  assert.match(
    await p.locator('meta[name="xiaowork-snapshot"]').getAttribute('content'),
    /^[a-f0-9]{64}$/,
  )
  assert.equal(
    await p.locator('link[rel="canonical"]').getAttribute('href'),
    'https://xiaoworks.com' + route,
  )
  const images = await p.locator('main img').evaluateAll((items) =>
    items.map((item) => ({
      // Lazy images may not have selected currentSrc yet. This checks their
      // declared versioned URL; the responsive loop later scrolls and decodes
      // every image before claiming that loading completed.
      src: item.currentSrc || item.src,
      loaded: item.complete && item.naturalWidth > 0,
    })),
  )
  assert.ok(
    images.every((item) =>
      new URL(item.src).pathname.startsWith('/_releases/' + releaseId + '/assets/'),
    ),
  )
  assert.ok(images.filter((item) => item.loaded).length > 0 || route === '/about/')
  if (route !== '/about/')
    await p.getByRole('heading', { name: content.projectName, exact: true }).waitFor()
}
async function checkDenied(p, paths, label) {
  const results = await p.evaluate(async (paths) => {
    const results = []
    for (const path of paths) {
      const response = await fetch(path, {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'manual',
      })
      results.push({ path, status: response.status, cache: response.headers.get('Cache-Control') })
    }
    return results
  }, paths)
  assert.ok(
    results.every((item) => item.status === 401),
    label + ' must reject HTML and each resource class',
  )
  report.previewAccess ??= []
  report.previewAccess.push({ label, results })
}
async function immutableProof(p, paths) {
  return await p.evaluate(async (paths) => {
    const results = []
    for (const path of paths) {
      const response = await fetch(path, { cache: 'no-store', credentials: 'omit' })
      const bytes = await response.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      results.push({
        path,
        status: response.status,
        sha256: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
      })
    }
    return results
  }, paths)
}

try {
  const trust = await prepareEnvironment()
  credentials = await initializeTestAdministrator()
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, true))
  report.browser = browser.version()
  context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
  })
  page = await context.newPage()
  observe(page)
  await login(page)
  await page.goto(origin + '/admin/publishing')
  await page.getByRole('heading', { name: '发布、预览与历史', exact: true }).waitFor()
  await refresh()
  record('真实 HTTPS 登录与独立本地发布门槛', '浏览器验证 CA 和主机名；未忽略证书错误')

  currentStep = 'save draft A and build private preview through UI'
  const contentA = await saveDraft('A')
  report.syntheticMedia = [{ version: 'A', ...contentA.media, realProjectScreenshot: false }]
  const previewJob = await create('preview')
  const previewRelease = (await read('/releases')).items.find(
    (item) => item.id === previewJob.releaseId,
  )
  assert.ok(previewRelease?.verified)
  const previewPath = previewRelease.previewUrl
  assert.match(previewPath, /^\/api\/admin\/v1\/previews\/pre_[a-f0-9]{32}\/$/)
  const popupPromise = context.waitForEvent('page')
  await page
    .locator('.publication-list li')
    .filter({ hasText: previewJob.releaseId })
    .getByRole('link', { name: /^打开私有预览/ })
    .click()
  let preview = await popupPromise
  observe(preview, 'preview-A')
  await preview.waitForLoadState('networkidle')
  await preview.getByRole('heading', { name: new RegExp(contentA.brand) }).waitFor()
  assert.equal(
    await preview.locator('meta[name="robots"]').getAttribute('content'),
    'noindex, nofollow, noarchive',
  )
  await screenshot('P6D-private-preview.png', preview)
  const privateResources = await preview.evaluate(() =>
    performance.getEntriesByType('resource').map((item) => new URL(item.name).pathname),
  )
  const representative = [previewPath]
  for (const pattern of [/\.js$/, /\.css$/, /\.(?:png|jpe?g|webp|avif|svg)$/]) {
    const match = privateResources.find(
      (item) => item.startsWith(previewPath) && pattern.test(item),
    )
    assert.ok(match, 'Preview must load authenticated JS, CSS and image resources')
    representative.push(match)
  }
  const previewMediaPath = previewPath + 'assets/' + contentA.media.path
  assert.ok(
    privateResources.includes(previewMediaPath),
    'Preview must load the sanitized synthetic media',
  )
  if (!representative.includes(previewMediaPath)) representative.push(previewMediaPath)
  const anonymousContext = await browser.newContext({ ignoreHTTPSErrors: false })
  const anonymous = await anonymousContext.newPage()
  observe(anonymous, 'anonymous')
  await anonymous.goto(origin + '/admin/login')
  await checkDenied(anonymous, representative, 'anonymous')
  await anonymousContext.close()
  record('真实 UI 私有预览与匿名拒绝', 'HTML、JS、CSS、图片均需登录；预览 noindex，不改变公开版本')

  currentStep = 'publish A through UI'
  const publicationA = await create('publish')
  report.publicationA = {
    releaseId: publicationA.releaseId,
    workspaceRevision: publicationA.workspaceRevision,
  }
  const oldTab = await context.newPage()
  observe(oldTab, 'retained-A')
  await oldTab.goto(origin + '/')
  await verifyPublic(oldTab, contentA, publicationA.releaseId, '/')
  const aResources = await oldTab.evaluate(() =>
    performance.getEntriesByType('resource').map((item) => new URL(item.name).pathname),
  )
  const aPaths = []
  for (const pattern of [/\.js$/, /\.css$/, /\.(?:png|jpe?g|webp|avif|svg)$/]) {
    const match = aResources.find(
      (item) => item.startsWith('/_releases/' + publicationA.releaseId + '/') && pattern.test(item),
    )
    assert.ok(match, 'A must request a versioned JS, CSS and image')
    aPaths.push(match)
  }
  const aMediaPath = '/_releases/' + publicationA.releaseId + '/assets/' + contentA.media.path
  assert.ok(aResources.includes(aMediaPath), 'Published A must load its sanitized synthetic media')
  if (!aPaths.includes(aMediaPath)) aPaths.push(aMediaPath)
  const aProofBefore = await immutableProof(oldTab, aPaths)
  assert.ok(aProofBefore.every((item) => item.status === 200))
  await screenshot('P6D-publication-A.png', oldTab)
  record('真实 UI 全站发布 A', '任务、活动指针、HTTP 页面与三类版本化资源真实核验')

  currentStep = 'save B without public change, then publish B'
  const contentB = await saveDraft('B')
  report.syntheticMedia.push({ version: 'B', ...contentB.media, realProjectScreenshot: false })
  assert.notEqual(contentB.media.sha256, contentA.media.sha256)
  const beforePublishB = await context.newPage()
  observe(beforePublishB, 'draft-B-public-A')
  await beforePublishB.goto(origin + '/')
  await verifyPublic(beforePublishB, contentA, publicationA.releaseId, '/')
  await beforePublishB.close()
  const publicationB = await create('publish')
  report.publicationB = {
    releaseId: publicationB.releaseId,
    workspaceRevision: publicationB.workspaceRevision,
  }
  const resourceStart = report.resources.length
  await oldTab
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '项目', exact: true })
    .click()
  await verifyPublic(oldTab, contentA, publicationA.releaseId, '/projects/')
  await oldTab
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '关于', exact: true })
    .click()
  await verifyPublic(oldTab, contentA, publicationA.releaseId, '/about/')
  const retainedResources = report.resources
    .slice(resourceStart)
    .filter((item) => item.page === 'retained-A')
  assert.ok(
    retainedResources.every((item) =>
      item.path.startsWith('/_releases/' + publicationA.releaseId + '/'),
    ),
  )
  assert.ok(retainedResources.every((item) => item.status === 200))
  const aProofAfter = await immutableProof(oldTab, aPaths)
  assert.deepEqual(aProofAfter, aProofBefore, 'A JS/CSS/image bytes must remain available after B')
  report.immutableResourceProof = {
    beforeB: aProofBefore,
    afterB: aProofAfter,
    retainedTabRequestsAfterB: retainedResources.length,
    prefetchNote:
      'Normal Nuxt speculative prefetch preserved; explicit no-store requests prove retained A resources with byte hashes.',
  }
  await oldTab.reload()
  await verifyPublic(oldTab, contentB, publicationB.releaseId, '/about/')
  await oldTab.goto(origin + '/')
  await verifyPublic(oldTab, contentB, publicationB.releaseId, '/')
  record(
    'A 标签跨 B 发布保持版本一致',
    '内部导航正文/SEO 保持 A；A JS/CSS/图片 no-store 请求200且哈希未变；正常预取保留，刷新切换 B',
  )

  currentStep = 'restore A through UI while draft B remains'
  await refresh()
  const aHistory = page
    .locator('.publication-list li')
    .filter({ has: page.locator('code').filter({ hasText: publicationA.releaseId }) })
  await aHistory.getByRole('button', { name: '选择恢复此版本', exact: true }).click()
  await reauth()
  await page.getByLabel('我确认恢复所选完整公开内容版本，并保留当前草稿。', { exact: true }).check()
  const rollback = await uiRequest(
    '/rollback-jobs',
    'POST',
    202,
    page.getByRole('button', { name: '确认本地恢复', exact: true }),
  )
  const restored = await waitJob(rollback.jobId, 'rollback')
  assert.equal(restored.releaseId, publicationA.releaseId)
  const draftAfterRestore = await read('/workspace')
  assert.equal(draftAfterRestore.revision, contentB.revision)
  assert.equal(draftAfterRestore.profile.site.name, contentB.brand)
  assert.ok(draftAfterRestore.projects.some((item) => item.name === contentB.projectName))
  for (const route of ['/', '/projects/', '/about/']) {
    await oldTab.goto(origin + route)
    await verifyPublic(oldTab, contentA, publicationA.releaseId, route)
  }
  await screenshot('P6D-release-history.png')
  record(
    '真实 UI 恢复 A 与草稿 B 保留',
    '三页公开内容、SEO、资源恢复 A；SQLite 草稿 revision/资料/项目保持 B',
  )

  currentStep = 'public three-page responsive themes and complete images'
  for (const width of [320, 390, 768, 1024, 1440]) {
    await oldTab.setViewportSize({ width, height: width <= 390 ? 844 : 1000 })
    for (const theme of ['dark', 'light']) {
      for (const route of ['/', '/projects/', '/about/']) {
        await oldTab.goto(origin + route)
        await verifyPublic(oldTab, contentA, publicationA.releaseId, route)
        if ((await oldTab.locator('html').getAttribute('data-theme')) !== theme)
          await oldTab.getByRole('button', { name: '切换深色或浅色主题', exact: true }).click()
        assert.equal(await oldTab.locator('html').getAttribute('data-theme'), theme)
        const imageElements = oldTab.locator('main img')
        for (const img of await imageElements.all()) {
          await img.scrollIntoViewIfNeeded()
          await img.evaluate(async (element) => {
            await element.decode()
          })
        }
        const dimensions = await oldTab.evaluate(() => ({
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          images: [...document.querySelectorAll('main img')].map((img) => ({
            path: new URL(img.currentSrc).pathname,
            loaded: img.complete && img.naturalWidth > 0 && img.naturalHeight > 0,
            width: img.getBoundingClientRect().width,
            height: img.getBoundingClientRect().height,
          })),
        }))
        assert.ok(
          dimensions.scroll <= dimensions.viewport,
          `Public overflow at ${width} ${theme} ${route}`,
        )
        assert.ok(
          dimensions.images.every((img) => img.loaded && img.width > 0 && img.height > 0),
          `Incomplete image at ${width} ${theme} ${route}`,
        )
        report.responsive.push({
          scope: 'public',
          width,
          theme,
          route,
          ...dimensions,
          result: 'PASS',
        })
        if (width === 1440 && route === '/')
          await screenshot(`P6D-public-home-${theme}.png`, oldTab)
        if (width === 390 && theme === 'dark' && route === '/')
          await screenshot('P6D-public-home-mobile.png', oldTab)
      }
    }
  }
  record(
    '公开静态三页五宽度双主题',
    '30组无页面级横向溢出，滚动触发全部图片并完成decode；保存首页深/浅/手机实际截图',
  )

  currentStep = 'publication responsive themes and mobile navigation'
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    for (const theme of ['dark', 'light']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page
          .getByRole('button', { name: theme === 'light' ? '切换到浅色主题' : '切换到深色主题' })
          .click()
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      assert.ok(
        dimensions.scroll <= dimensions.viewport,
        `Publication overflow at ${width} ${theme}`,
      )
      report.responsive.push({
        scope: 'admin',
        width,
        theme,
        route: '/admin/publishing',
        ...dimensions,
        result: 'PASS',
      })
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot('P6D-publishing-mobile.png')
  await page.getByRole('button', { name: '打开管理菜单', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'XiaoWork 管理菜单' })
  await menu.getByRole('link', { name: '工作区概览', exact: true }).click()
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  await page.getByRole('button', { name: '打开管理菜单', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'XiaoWork 管理菜单' })
    .getByRole('link', { name: '发布、预览与历史', exact: true })
    .click()
  await page.getByRole('heading', { name: '发布、预览与历史', exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await screenshot('P6D-publishing-light.png')
  record(
    '发布页五宽度双主题与移动导航',
    '320/390/768/1024/1440px 无页面级横向溢出；真实菜单路由工作',
  )

  currentStep = 'retained-volume container recreation'
  const retainedCookies = await context.cookies()
  await browser.close()
  browser = undefined
  stopBrowserContainer()
  recreateEnvironment()
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, true))
  context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
  })
  await context.addCookies(retainedCookies)
  page = await context.newPage()
  observe(page, 'admin-after-recreation')
  await page.goto(origin + '/admin/publishing')
  await page.getByRole('heading', { name: '发布、预览与历史', exact: true }).waitFor()
  await refresh()
  const persistedDraft = await read('/workspace')
  const persistedStatus = await read('/publishing-status')
  const persistedReleases = (await read('/releases')).items
  assert.equal(persistedDraft.revision, contentB.revision)
  assert.equal(persistedDraft.profile.site.name, contentB.brand)
  assert.equal(persistedStatus.activeReleaseId, publicationA.releaseId)
  assert.equal(persistedStatus.activeVerified, true)
  for (const id of [publicationA.releaseId, publicationB.releaseId, previewJob.releaseId])
    assert.ok(persistedReleases.some((item) => item.id === id && item.verified))
  const resumedPublic = await context.newPage()
  observe(resumedPublic, 'public-after-recreation')
  await resumedPublic.goto(origin + '/')
  await verifyPublic(resumedPublic, contentA, publicationA.releaseId, '/')
  assert.deepEqual(await immutableProof(resumedPublic, aPaths), aProofBefore)
  preview = await context.newPage()
  observe(preview, 'preview-after-recreation')
  await preview.goto(origin + previewPath)
  await preview.getByRole('heading', { name: new RegExp(contentA.brand) }).waitFor()
  await preview.waitForLoadState('networkidle')
  const persistedPreviewStatuses = await preview.evaluate(async (paths) => {
    const results = []
    for (const path of paths)
      results.push({
        path,
        status: (await fetch(path, { cache: 'no-store', credentials: 'same-origin' })).status,
      })
    return results
  }, representative)
  assert.ok(persistedPreviewStatuses.every((item) => item.status === 200))
  report.persistence = {
    draftRevision: persistedDraft.revision,
    activeReleaseId: persistedStatus.activeReleaseId,
    verifiedRetainedReleases: [
      publicationA.releaseId,
      publicationB.releaseId,
      previewJob.releaseId,
    ],
    previewResources: persistedPreviewStatuses,
    result: 'PASS',
  }
  await screenshot('P6D-after-recreation.png')
  record(
    '保卷重建与会话/历史/静态产物持久',
    'API、worker、静态服务、gateway重建；草稿B/currentA与历史/私有预览仍实际可用',
  )

  currentStep = 'private preview revoked after logout and session expiry'
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor()
  await checkDenied(preview, representative, 'logged-out')
  await login(page)
  const sessionCookie = (await context.cookies()).find(
    (item) => item.name === '__Host-xiaowork-admin',
  )
  assert.ok(sessionCookie?.value)
  // The offline fixture shortens expiry to created_at+1 and refuses a session
  // that is still younger than that interval. Keep that safety condition.
  await pause(2200)
  expireSession(createHash('sha256').update(sessionCookie.value).digest('hex'))
  await checkDenied(preview, representative, 'expired-session')
  record(
    '退出与会话到期后全部预览资源拒绝',
    '真实服务逐项 401；此项是 Session 到期，预览 TTL 另由 API 集成测试覆盖',
  )
  assert.deepEqual(report.consoleErrors, [])
  record('前台与管理运行时无 hydration/CSP 错误', '实际控制台、pageerror 与新版本资源请求记录')
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  let message = error instanceof Error ? error.message : 'Unknown local browser test failure'
  if (credentials?.password) message = message.replaceAll(credentials.password, '[redacted]')
  report.failure = { step: currentStep, message }
  console.error(`FAIL ${currentStep}: ${message}`)
  if (page && !page.isClosed()) {
    try {
      for (const input of await page.locator('input[type="password"]').all())
        await input.evaluate((element) => {
          element.value = ''
        })
      await screenshot('P6D-browser-failure.png')
    } catch {
      /* Browser may have disconnected; never dump private DOM or request bodies. */
    }
  }
  process.exitCode = 1
} finally {
  allowDialog = true
  if (browser) await browser.close()
  stopBrowserContainer()
  report.certificateTrustRemoved = true
  await writeFile(
    path.join(evidence, evidenceName('P6D-browser.json')),
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(
    'Evidence: docs/evidence/P6D-browser.json; no passwords, CSRF, cookies or private request bodies recorded.',
  )
}
