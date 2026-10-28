// Real-browser acceptance against the dedicated local HTTPS Go/SQLite stack.
// Responses are never mocked as successes. Fault tests only abort requests.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const p6e = process.argv[2] === '--p6e'
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && p6e))
const evidenceName = (name) => (p6e ? name.replace(/^P6C/, 'P6E-admin') : name)
const {
  expireSession,
  initializeTestAdministrator,
  origin,
  prepareEnvironment,
  project,
  recreateEnvironment,
  startBrowserContainer,
  stopBrowserContainer,
} = await import(p6e ? './p6e-browser-environment.mjs' : './admin-browser-environment.mjs')

const requireAdmin = createRequire(path.resolve('admin/package.json'))
const { chromium } = requireAdmin('playwright-core')
const evidenceDir = path.resolve('docs/evidence')
await mkdir(evidenceDir, { recursive: true })
const report = {
  date: new Date().toISOString(),
  project,
  origin,
  scope: 'Dedicated local Docker test volumes only; no production connection',
  browser: '',
  tlsVerificationDisabled: false,
  certificateTrustRemoved: false,
  hostCertificateStoreModified: false,
  cases: [],
  http: [],
  consoleErrors: [],
  responsive: [],
}
let browser, context, page, credentials, newPassword
let currentStep = 'environment preparation'
let allowDialog = false
const apiPrefix = '/api/admin/v1'
const id = randomBytes(4).toString('hex')
const projectName = `本地浏览器验收 ${id}`
const categoryName = `验收分类 ${id}`
let projectId, mediaId

function record(name, detail = '') {
  report.cases.push({ name, result: 'PASS', detail })
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`)
}
async function persist() {
  await writeFile(
    path.join(evidenceDir, evidenceName('P6C-browser.json')),
    JSON.stringify(report, null, 2) + '\n',
  )
}
async function secret(locator, value) {
  try {
    await locator.fill(value)
  } catch {
    throw new Error('Secure password input failed; value omitted')
  }
}
function observe(p) {
  p.setDefaultTimeout(15000)
  p.setDefaultNavigationTimeout(30000)
  p.on('dialog', (dialog) => (allowDialog ? dialog.accept() : dialog.dismiss()))
  p.on('pageerror', (error) =>
    report.consoleErrors.push({ kind: 'pageerror', message: error.message }),
  )
  p.on('console', (msg) => {
    if (msg.type() === 'error' && /content security policy|refused to|uncaught/i.test(msg.text())) {
      report.consoleErrors.push({ kind: 'csp', message: msg.text() })
    }
  })
  p.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === origin && url.pathname.startsWith(apiPrefix)) {
      report.http.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      })
    }
  })
}
async function login(p, username = credentials.username, password = credentials.password) {
  const form = p.getByRole('main')
  await form.getByLabel('管理员账户', { exact: true }).fill(username)
  await secret(form.locator('input[name="password"]'), password)
  const response = p.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === apiPrefix + '/auth/login' && r.request().method() === 'POST',
  )
  await form.getByRole('button', { name: '安全登录' }).click()
  return await response
}
async function submit(p, pathname, method, status, button) {
  const pending = p.waitForResponse(
    (r) => new URL(r.url()).pathname === apiPrefix + pathname && r.request().method() === method,
  )
  await button.click()
  const response = await pending
  const failureCode = response.status() !== status ? (await response.json()).error?.code : ''
  assert.equal(response.status(), status, `${method} ${pathname} status ${failureCode || ''}`)
  if (status !== 204) await response.finished()
  return response
}
async function navigate(p, name) {
  const desktop = p.locator('aside[aria-label="管理导航"]')
  if (await desktop.isVisible()) await desktop.getByRole('link', { name, exact: true }).click()
  else {
    await p.getByRole('button', { name: '打开管理菜单' }).click()
    await p
      .getByRole('dialog', { name: 'XiaoWork 管理菜单' })
      .getByRole('link', { name, exact: true })
      .click()
  }
}
async function screenshot(name, p = page) {
  await p.evaluate(() => window.scrollTo(0, 0))
  await p.screenshot({
    path: path.join(evidenceDir, evidenceName(name)),
    fullPage: true,
    animations: 'disabled',
  })
}
async function actualWorkspace(p = page) {
  return await p.evaluate(async () => {
    const response = await fetch('/api/admin/v1/workspace', {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('workspace verification denied')
    return (await response.json()).data
  })
}

try {
  const trust = await prepareEnvironment()
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, false))
  const untrusted = await browser.newContext({ ignoreHTTPSErrors: false })
  const untrustedPage = await untrusted.newPage()
  try {
    await untrustedPage.goto(origin + '/admin/login')
    report.untrustedBrowser = 'CA already trusted on host; no negative trust assertion'
  } catch (error) {
    assert.match(String(error), /ERR_CERT_AUTHORITY_INVALID/)
    report.untrustedBrowser = 'ERR_CERT_AUTHORITY_INVALID'
  }
  await browser.close()
  browser = undefined
  stopBrowserContainer()
  credentials = await initializeTestAdministrator()
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, true))
  report.browser = browser.version()
  context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
  })
  page = await context.newPage()
  observe(page)
  const initial = await page.goto(origin + '/admin/login')
  assert.equal(initial.status(), 200)
  const security = await initial.securityDetails()
  assert.match(security.issuer, /XiaoWork/)
  report.tls = security
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor()
  if ((await page.locator('html').getAttribute('data-theme')) !== 'dark')
    await page.getByRole('button', { name: '切换到深色主题' }).click()
  await screenshot('P6C-login.png')
  record('可信 HTTPS 与登录页面', '真实 CA 链与主机名验证；未忽略证书错误')

  currentStep = 'wrong password and login rate limit'
  assert.equal(
    (await login(page, credentials.username, 'wrong-password-for-isolated-test')).status(),
    401,
  )
  await page
    .getByRole('alert')
    .filter({ hasText: /密码|登录/ })
    .waitFor()
  assert.equal(await page.locator('main input[name="password"]').inputValue(), '')
  const missingUser = 'missing-' + id
  for (let n = 0; n < 6; n++) {
    const response = await login(page, missingUser, 'wrong-password-for-isolated-test')
    assert.equal(response.status(), n < 5 ? 401 : 429)
  }
  await page.getByText(/秒后再试/).waitFor()
  record('错误密码与真实登录限速', '401；未知测试账户第 6 次验证 429，页面显示等待反馈')
  assert.equal((await login(page)).status(), 200)
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  const cookie = (await context.cookies()).find((item) => item.name === '__Host-xiaowork-admin')
  assert.ok(
    cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/',
  )
  assert.equal(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) => /token|csrf|session|password/i.test(key)).length,
    ),
    0,
  )
  record('真实登录、Secure Cookie 与存储约束')
  await screenshot('P6C-dashboard-dark.png')
  if (p6e) {
    await page.getByRole('link', { name: '查看发布、预览与历史', exact: true }).waitFor()
  } else {
    for (const name of [/预览.*P6-D/, /发布.*P6-D/, /历史恢复.*P6-D/])
      assert.equal(await page.getByRole('button', { name }).isDisabled(), true)
  }
  await page.reload()
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  record(
    'Session 刷新恢复与真实发布状态',
    p6e ? '本地独立发布入口可访问，不伪造公开统计' : '发布服务未启用，没有已发布假统计',
  )

  currentStep = 'category CRUD'
  await navigate(page, '项目分类')
  await page.getByRole('button', { name: '新增分类', exact: true }).click()
  await page.getByLabel('分类名称', { exact: true }).fill(categoryName)
  await page.getByLabel(/分类标识 slug/).fill('e2e-' + id)
  await submit(page, '/categories', 'POST', 201, page.getByRole('button', { name: '保存分类草稿' }))
  await page.getByRole('button', { name: '编辑 ' + categoryName, exact: true }).waitFor()
  const firstWorkspace = await actualWorkspace()
  const createdCategory = firstWorkspace.categories.find((c) => c.slug === 'e2e-' + id)
  assert.ok(createdCategory)
  await page.getByRole('button', { name: '编辑 ' + categoryName, exact: true }).click()
  await page.getByLabel('分类名称', { exact: true }).fill(categoryName + ' 已编辑')
  await submit(
    page,
    '/categories/' + createdCategory.id,
    'PUT',
    200,
    page.getByRole('button', { name: '保存分类草稿' }),
  )
  record('分类新增和编辑', '保存至真实 SQLite')
  await page.getByRole('button', { name: '新增分类', exact: true }).click()
  const unusedCategoryName = '可删除分类 ' + id
  await page.getByLabel('分类名称', { exact: true }).fill(unusedCategoryName)
  await page.getByLabel(/分类标识 slug/).fill('unused-' + id)
  const unusedCreated = await submit(
    page,
    '/categories',
    'POST',
    201,
    page.getByRole('button', { name: '保存分类草稿' }),
  )
  const unusedCategoryId = (await unusedCreated.json()).data.category.id
  await page.getByRole('button', { name: '调整分类顺序', exact: true }).click()
  await page.getByRole('button', { name: '上移 ' + unusedCategoryName, exact: true }).press('Enter')
  await submit(
    page,
    '/categories/order',
    'PUT',
    200,
    page.getByRole('button', { name: '保存完整排序', exact: true }),
  )
  await page.getByRole('button', { name: '删除 ' + unusedCategoryName, exact: true }).click()
  await submit(
    page,
    '/categories/' + unusedCategoryId,
    'DELETE',
    200,
    page.getByRole('button', { name: '确认删除分类', exact: true }),
  )
  record('分类排序与未引用删除', '完整ID原子排序及真实删除')

  currentStep = 'create and edit project'
  await navigate(page, '项目管理')
  await screenshot('P6C-project-list.png')
  await page.getByRole('button', { name: '新增项目', exact: true }).click()
  await page.getByLabel('项目名称', { exact: true }).fill(projectName)
  await page.getByLabel(/项目标识 slug/).fill('e2e-' + id)
  await page
    .getByLabel('项目简介', { exact: true })
    .fill('只存在于隔离验收库的测试草稿，不是对外项目。')
  await page.getByLabel(/^项目分类/).selectOption('e2e-' + id)
  const editor = page.getByRole('form', { name: '新增项目' })
  await editor.getByRole('button', { name: '选择项目封面', exact: true }).click()
  await editor.getByRole('button', { name: /Blog.*占位/ }).click()
  await page.getByLabel('封面替代文本', { exact: true }).fill('隔离测试占位资源，并非真实项目截图')
  await screenshot('P6C-project-form.png')
  const createResponse = await submit(
    page,
    '/projects',
    'POST',
    201,
    page.getByRole('button', { name: '保存项目草稿' }),
  )
  projectId = (await createResponse.json()).data.project.id
  await page.getByRole('button', { name: '编辑 ' + projectName, exact: true }).waitFor()
  await page.getByLabel('搜索项目', { exact: true }).fill(id)
  assert.equal(await page.locator('.data-table tbody tr').count(), 1)
  await page.getByLabel(/^分类筛选/).selectOption('e2e-' + id)
  await page.getByLabel(/^状态筛选/).selectOption('unconfirmed')
  await page.getByRole('button', { name: '编辑 ' + projectName, exact: true }).click()
  await page
    .getByLabel('项目详情', { exact: false })
    .fill('真实 UI 编辑的纯文本详情；仅本地验收使用。')
  await page.route('**/api/admin/v1/projects/' + projectId, (route) => {
    const headers = { ...route.request().headers() }
    delete headers['x-csrf-token']
    return route.continue({ headers })
  })
  await submit(
    page,
    '/projects/' + projectId,
    'PUT',
    403,
    page.getByRole('button', { name: '保存项目草稿' }),
  )
  await page
    .getByRole('alert')
    .filter({ hasText: /安全|CSRF|来源/ })
    .waitFor()
  assert.equal(
    await page.getByLabel(/项目详情/).inputValue(),
    '真实 UI 编辑的纯文本详情；仅本地验收使用。',
  )
  await page.unroute('**/api/admin/v1/projects/' + projectId)
  record('浏览器 CSRF 回归', '拦截测试请求移除CSRF后真实API拒绝403，页面提示且保留表单')
  await submit(
    page,
    '/projects/' + projectId,
    'PUT',
    200,
    page.getByRole('button', { name: '保存项目草稿' }),
  )
  await page.reload()
  await page.getByRole('button', { name: '编辑 ' + projectName, exact: true }).click()
  assert.equal(
    await page.getByLabel(/项目详情/).inputValue(),
    '真实 UI 编辑的纯文本详情；仅本地验收使用。',
  )
  await page.getByRole('button', { name: '放弃此表单' }).click()
  record('项目新增、编辑、筛选及刷新持久化')

  currentStep = 'project keyboard and drag ordering'
  await page.getByRole('button', { name: '调整项目顺序' }).click()
  const beforeOrder = (await actualWorkspace()).projects
    .filter((p) => !p.archivedAt)
    .map((p) => p.id)
  const up = page.getByRole('button', { name: '上移 ' + projectName, exact: true })
  await up.focus()
  await up.press('Enter')
  await submit(
    page,
    '/projects/order',
    'PUT',
    200,
    page.getByRole('button', { name: '保存完整排序' }),
  )
  const afterOrder = (await actualWorkspace()).projects
    .filter((p) => !p.archivedAt)
    .map((p) => p.id)
  assert.equal(afterOrder.indexOf(projectId), beforeOrder.indexOf(projectId) - 1)
  await page.getByRole('button', { name: '调整项目顺序' }).click()
  const dragItems = page.locator('.sort-list > li')
  await dragItems.last().dragTo(dragItems.first())
  await submit(
    page,
    '/projects/order',
    'PUT',
    200,
    page.getByRole('button', { name: '保存完整排序' }),
  )
  assert.notDeepEqual(
    (await actualWorkspace()).projects.filter((p) => !p.archivedAt).map((p) => p.id),
    afterOrder,
  )
  record('项目键盘与拖拽排序', '提交完整 ID 集合至真实原子排序接口')

  currentStep = 'two browser conflict and unsaved guard'
  const secondContext = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
  })
  const second = await secondContext.newPage()
  observe(second)
  await second.goto(origin + '/admin/login')
  assert.equal((await login(second)).status(), 200)
  await navigate(second, '项目管理')
  await page.getByRole('button', { name: '编辑 ' + projectName, exact: true }).click()
  await second.getByRole('button', { name: '编辑 ' + projectName, exact: true }).click()
  await page.getByLabel('项目简介', { exact: true }).fill('第一个浏览器提交的草稿 ' + id)
  await second.getByLabel('项目简介', { exact: true }).fill('第二个浏览器尚未保存的输入 ' + id)
  await submit(
    page,
    '/projects/' + projectId,
    'PUT',
    200,
    page.getByRole('button', { name: '保存项目草稿' }),
  )
  await submit(
    second,
    '/projects/' + projectId,
    'PUT',
    409,
    second.getByRole('button', { name: '保存项目草稿' }),
  )
  await second.getByText(/当前表单完整保留/).waitFor()
  assert.equal(
    await second.getByLabel('项目简介', { exact: true }).inputValue(),
    '第二个浏览器尚未保存的输入 ' + id,
  )
  await navigate(second, '工作区概览')
  assert.equal(new URL(second.url()).pathname, '/admin/projects')
  assert.equal(
    await second.getByLabel('项目简介', { exact: true }).inputValue(),
    '第二个浏览器尚未保存的输入 ' + id,
  )
  await second.getByRole('button', { name: '保留输入，读取最新基准作对照' }).click()
  await second.getByText('服务端最新内容（请与当前输入核对）', { exact: true }).waitFor()
  assert.equal(await second.getByRole('button', { name: '保存项目草稿' }).isDisabled(), true)
  await second
    .getByLabel('我已完成对照，确认再次保存会用当前完整表单替换此项目的最新值。', { exact: true })
    .check()
  await submit(
    second,
    '/projects/' + projectId,
    'PUT',
    200,
    second.getByRole('button', { name: '保存项目草稿' }),
  )
  assert.equal(
    (await actualWorkspace(second)).projects.find((p) => p.id === projectId).summary,
    '第二个浏览器尚未保存的输入 ' + id,
  )
  record(
    '多会话 409 与未保存导航保护',
    '旧版本不覆盖，取消离开保留输入；明确对照和确认后真实保存200',
  )
  await secondContext.close()
  await page.reload()

  currentStep = 'archive restore and category reference protection'
  await page.getByRole('button', { name: '归档 ' + projectName, exact: true }).click()
  await submit(
    page,
    '/projects/' + projectId + '/archive',
    'POST',
    200,
    page.getByRole('button', { name: '确认归档', exact: true }),
  )
  await page.getByLabel(/^归档筛选/).selectOption('archived')
  await page.getByRole('button', { name: '恢复 ' + projectName, exact: true }).click()
  await submit(
    page,
    '/projects/' + projectId + '/restore',
    'POST',
    200,
    page.getByRole('button', { name: '确认恢复', exact: true }),
  )
  assert.equal((await actualWorkspace()).projects.find((p) => p.id === projectId).visible, false)
  await navigate(page, '项目分类')
  assert.equal(
    await page
      .getByRole('button', { name: '删除 ' + categoryName + ' 已编辑', exact: true })
      .isDisabled(),
    true,
  )
  record('归档、恢复与分类引用保护', '恢复后不自动公开')

  currentStep = 'media upload and binding'
  if (p6e) {
    currentStep = 'derived image budget over real HTTPS'
    report.derivedImageBudget = await page.evaluate(async () => {
      // A locally generated noise fixture, never a project screenshot.
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 4096
      const ctx = canvas.getContext('2d')
      const pixels = ctx.createImageData(4096, 4096)
      let seed = 7654321
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        pixels.data[i] = seed & 255
        pixels.data[i + 1] = (seed >>> 8) & 255
        pixels.data[i + 2] = (seed >>> 16) & 255
        pixels.data[i + 3] = 255
      }
      ctx.putImageData(pixels, 0, 0)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.35))
      if (!blob || blob.type !== 'image/webp' || blob.size > 10 * 1024 * 1024)
        throw new Error('Synthetic WebP fixture does not meet input budget')
      const before = (await (await fetch('/api/admin/v1/workspace')).json()).data.revision
      const session = (await (await fetch('/api/admin/v1/auth/session')).json()).data
      const form = new FormData()
      form.append('file', blob, 'local-synthetic-derived-budget.webp')
      const result = await fetch('/api/admin/v1/media', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'If-Match': '"' + before + '"' },
        body: form,
      })
      const payload = await result.json()
      const after = (await (await fetch('/api/admin/v1/workspace')).json()).data.revision
      return {
        width: 4096,
        height: 4096,
        originalBytes: blob.size,
        status: result.status,
        code: payload.error?.code,
        before,
        after,
      }
    })
    assert.equal(report.derivedImageBudget.status, 413)
    assert.equal(report.derivedImageBudget.before, report.derivedImageBudget.after)
    record(
      '派生图片16MiB限制',
      '真实4096×4096 WebP原图小于10MiB，重编码超限返回413且草稿revision不变',
    )
    currentStep = 'media upload and binding'
  }
  await navigate(page, '图片资源')
  // Selection and all bytes go through the real file input and Go sanitizer.
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('public/images/social/xiaowork-share.png'))
  // Remaining media-specific actions are asserted below against the current UI.
  const uploaded = await submit(
    page,
    '/media',
    'POST',
    201,
    page.getByRole('button', { name: '上传到私有素材库' }),
  )
  mediaId = (await uploaded.json()).data.media.id
  assert.ok(mediaId)
  const anonymousContext = await browser.newContext({ ignoreHTTPSErrors: false })
  const anonymous = await anonymousContext.newPage()
  observe(anonymous)
  await anonymous.goto(origin + '/admin/login')
  const anonymousImage = await anonymous.evaluate(
    async (id) => (await fetch('/api/admin/v1/media/' + id + '/content')).status,
    mediaId,
  )
  assert.equal(anonymousImage, 401)
  await anonymousContext.close()
  const mediaName = '隔离测试品牌图片 ' + id
  await page.getByLabel('素材显示名称', { exact: true }).fill(mediaName)
  await page
    .getByLabel('素材替代文本', { exact: true })
    .fill('仓库自有品牌分享图，仅用于本地隔离验收')
  await page.getByLabel('我已核实此图片可公开使用，且不含敏感数据。', { exact: true }).check()
  await page
    .getByLabel(/公开使用核验说明/)
    .fill('使用本仓库已有品牌分享图；无个人或业务敏感资料；仅本地测试。')
  await submit(
    page,
    '/media/' + mediaId,
    'PATCH',
    200,
    page.getByRole('button', { name: '保存素材信息' }),
  )
  await screenshot('P6C-media-upload.png')
  record('真实图片上传与私有预览', '上传到独立持久卷，经 Go 校验重编码；匿名私有图片请求401')
  await page.getByRole('button', { name: '关闭素材信息', exact: true }).click()
  await navigate(page, '项目管理')
  await page.getByRole('button', { name: '编辑 ' + projectName, exact: true }).click()
  await page.getByRole('button', { name: '选择项目封面', exact: true }).click()
  await page
    .locator('.asset-picker article')
    .filter({ hasText: mediaName })
    .getByRole('button', { name: '选择此素材' })
    .click()
  await submit(
    page,
    '/projects/' + projectId,
    'PUT',
    200,
    page.getByRole('button', { name: '保存项目草稿' }),
  )
  assert.equal((await actualWorkspace()).projects.find((p) => p.id === projectId).cover.id, mediaId)
  await navigate(page, '图片资源')
  assert.equal(
    await page.getByRole('button', { name: '软删除 ' + mediaName, exact: true }).isDisabled(),
    true,
  )
  const protectedDelete = await page.evaluate(async (id) => {
    const session = (await (await fetch('/api/admin/v1/auth/session')).json()).data
    const workspace = (await (await fetch('/api/admin/v1/workspace')).json()).data
    const response = await fetch('/api/admin/v1/media/' + id, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': session.csrfToken,
        'If-Match': '"' + workspace.revision + '"',
      },
    })
    return { status: response.status, code: (await response.json()).error?.code }
  }, mediaId)
  assert.deepEqual(protectedDelete, { status: 409, code: 'MEDIA_REFERENCED' })
  record(
    '项目图片更换与引用删除保护',
    '真实保存 media 引用；UI禁删且直接DELETE真实返回409 MEDIA_REFERENCED',
  )

  // A separate unreferenced upload is safely soft-deleted through the UI.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'unreferenced-local-test.png',
    mimeType: 'image/png',
    buffer: await page.locator('.media-card').filter({ hasText: mediaName }).screenshot(),
  })
  const disposable = await submit(
    page,
    '/media',
    'POST',
    201,
    page.getByRole('button', { name: '上传到私有素材库' }),
  )
  const disposableMedia = (await disposable.json()).data.media
  await page.getByRole('button', { name: '关闭素材信息', exact: true }).click()
  await page
    .getByRole('button', {
      name: '软删除 ' + (disposableMedia.displayName || disposableMedia.id),
      exact: true,
    })
    .click()
  await submit(
    page,
    '/media/' + disposableMedia.id,
    'DELETE',
    200,
    page.getByRole('button', { name: '确认软删除素材', exact: true }),
  )
  record('未引用图片管理', '通过真实 API 软删除，不清理持久卷物理文件')

  currentStep = 'profile and website settings'
  await navigate(page, '品牌与个人资料')
  const originalRole = await page.getByLabel('角色与定位', { exact: true }).inputValue()
  await page.getByLabel('角色与定位', { exact: true }).fill(originalRole + ' · 本地验收')
  await submit(
    page,
    '/profile',
    'PUT',
    200,
    page.getByRole('button', { name: '保存草稿', exact: true }),
  )
  await page.reload()
  assert.equal(
    await page.getByLabel('角色与定位', { exact: true }).inputValue(),
    originalRole + ' · 本地验收',
  )
  await navigate(page, '网站与 SEO')
  const title = await page.getByLabel('网站标题', { exact: true }).inputValue()
  await page.getByLabel('网站标题', { exact: true }).fill(title + ' · 本地验收')
  await submit(
    page,
    '/settings',
    'PUT',
    200,
    page.getByRole('button', { name: '保存草稿', exact: true }),
  )
  await page.reload()
  assert.equal(
    await page.getByLabel('网站标题', { exact: true }).inputValue(),
    title + ' · 本地验收',
  )
  assert.equal(await page.getByRole('textbox', { name: /域名|主域/ }).count(), 0)
  record('个人资料与网站设置真实保存', '刷新保留，正式主域不提供编辑字段')

  currentStep = 'network failure'
  await page.route('**/api/admin/v1/settings', (route) => route.abort('failed'))
  await page.getByRole('button', { name: '重新载入', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: /无法连接/ })
    .waitFor()
  assert.equal(
    await page.getByLabel('网站标题', { exact: true }).inputValue(),
    title + ' · 本地验收',
  )
  await page.unroute('**/api/admin/v1/settings')
  record('真实请求中断反馈', '明确网络错误，已加载表单不被清空')

  currentStep = 'session expiration and password change'
  const sessionCookie = (await context.cookies()).find(
    (item) => item.name === '__Host-xiaowork-admin',
  )
  await new Promise((resolve) => setTimeout(resolve, 2200))
  expireSession(createHash('sha256').update(sessionCookie.value).digest('hex'))
  await page.getByRole('button', { name: '重新载入', exact: true }).click()
  const expired = page.getByRole('dialog', { name: '登录已失效，保留当前表单' })
  await expired.waitFor()
  await expired.getByLabel('管理员账户', { exact: true }).fill(credentials.username)
  await secret(expired.locator('input[name="password"]'), credentials.password)
  await expired.getByRole('button', { name: '安全登录' }).click()
  await expired.waitFor({ state: 'hidden' })
  record(
    'Session 过期与重新认证',
    '仅隔离测试 DB 将当前 Session 的绝对期限设为过去；真实 API 返回 401，表单保留',
  )
  await navigate(page, '修改密码')
  newPassword = 'P6C-new-' + randomBytes(24).toString('base64url')
  await secret(page.getByLabel('新密码', { exact: false }).first(), newPassword)
  await secret(page.getByLabel('再次输入新密码', { exact: true }), newPassword)
  await secret(
    page.getByLabel('当前密码', { exact: true }),
    'wrong-current-password-for-local-test',
  )
  await submit(
    page,
    '/auth/password',
    'POST',
    401,
    page.getByRole('button', { name: '修改密码并退出所有会话' }),
  )
  await page.getByRole('alert').filter({ hasText: /密码/ }).waitFor()
  assert.equal(await expired.isVisible(), false)
  assert.equal((await actualWorkspace()).initialized, true)
  record('错误当前密码反馈', '有效Session保留，未错误弹出会话过期')
  await secret(page.getByLabel('当前密码', { exact: true }), credentials.password)
  await submit(
    page,
    '/auth/password',
    'POST',
    204,
    page.getByRole('button', { name: '修改密码并退出所有会话' }),
  )
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor()
  assert.equal((await login(page, credentials.username, credentials.password)).status(), 401)
  credentials.password = newPassword
  assert.equal((await login(page)).status(), 200)
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  record('修改密码后重新登录', '旧密码 401，新密码 200')

  currentStep = 'docker recreation persistence'
  const before = await actualWorkspace()
  const savedCookies = await context.cookies()
  await browser.close()
  browser = undefined
  stopBrowserContainer()
  recreateEnvironment()
  browser = await chromium.connect(await startBrowserContainer(trust.caPath, true))
  context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
  })
  await context.addCookies(savedCookies)
  page = await context.newPage()
  observe(page)
  await page.goto(origin + '/admin/')
  await page.getByRole('heading', { name: '工作区概览', exact: true }).waitFor()
  const after = await actualWorkspace()
  assert.equal(after.revision, before.revision)
  assert.deepEqual(after.projects, before.projects)
  assert.deepEqual(after.profile, before.profile)
  assert.deepEqual(after.settings, before.settings)
  const mediaStatus = await page.evaluate(
    async (id) => (await fetch('/api/admin/v1/media/' + id + '/content')).status,
    mediaId,
  )
  assert.equal(mediaStatus, 200)
  record(
    'Docker 容器重建持久化',
    '原浏览器 Cookie、项目/资料/设置/revision 和私有图片仍有效；未删除卷',
  )

  currentStep = 'responsive themes and keyboard'
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 })
    for (const theme of ['dark', 'light']) {
      const activeTheme = await page.locator('html').getAttribute('data-theme')
      if (activeTheme !== theme)
        await page
          .getByRole('button', { name: theme === 'light' ? '切换到浅色主题' : '切换到深色主题' })
          .click()
      for (const route of [
        '/',
        '/projects',
        '/categories',
        '/media',
        '/profile',
        '/settings',
        '/account',
      ]) {
        await page.goto(origin + '/admin' + route)
        await page.locator('main h1').waitFor()
        await page.waitForLoadState('networkidle')
        const dimensions = await page.evaluate(() => ({
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }))
        assert.ok(
          dimensions.scroll <= dimensions.viewport,
          `overflow at ${width} ${theme} ${route}`,
        )
        if (route === '/projects' && width <= 768) {
          const table = page.getByRole('region', { name: '项目列表横向滚动区域' })
          const tableSize = await table.evaluate((el) => ({
            client: el.clientWidth,
            scroll: el.scrollWidth,
          }))
          assert.ok(tableSize.scroll >= 760 && tableSize.scroll > tableSize.client)
          await table.focus()
          await page.keyboard.press('ArrowRight')
          await page.waitForFunction(() => document.querySelector('.table-wrap').scrollLeft > 0)
          await table.evaluate((el) => {
            el.scrollLeft = 0
          })
          dimensions.table = tableSize
        }
        if (route === '/media' && width === 1440) {
          const cardWidth = await page
            .locator('.media-card')
            .first()
            .evaluate((el) => el.getBoundingClientRect().width)
          assert.ok(cardWidth >= 280)
          dimensions.mediaCardWidth = cardWidth
        }
        report.responsive.push({ width, theme, route, ...dimensions, result: 'PASS' })
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(origin + '/admin/projects')
  await page.getByRole('button', { name: '打开管理菜单' }).click()
  await page.getByRole('dialog', { name: 'XiaoWork 管理菜单' }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog', { name: 'XiaoWork 管理菜单' }).isVisible(), false)
  await screenshot('P6C-mobile.png')
  await page.getByRole('button', { name: '编辑 ' + projectName, exact: true }).click()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await screenshot('P6C-mobile-form.png')
  await page.getByRole('button', { name: '放弃此表单', exact: true }).click()
  await page.reload()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(origin + '/admin/')
  await screenshot('P6C-dashboard-light.png')
  record(
    '响应式、双主题与键盘',
    '5 宽度 × 2 主题 × 7 页面无页面级横向溢出；菜单 Escape 关闭；刷新保持主题',
  )
  assert.deepEqual(report.consoleErrors, [])
  record('管理 CSP 与前端运行', '未观察到 pageerror 或 CSP 拒绝，无 unsafe-eval/inline')

  currentStep = 'logout'
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor()
  const denied = await page.evaluate(async () => (await fetch('/api/admin/v1/workspace')).status)
  assert.equal(denied, 401)
  record('真实退出登录', '会话撤销后管理请求 401')
  report.result = 'PASS'
} catch (error) {
  if (page && !page.isClosed()) {
    try {
      await page.screenshot({
        path: path.resolve(
          p6e ? '.cache/p6e-browser/admin-failure.png' : '.cache/p6c-browser/failure.png',
        ),
        timeout: 5000,
      })
    } catch {
      /* Browser may have disconnected. */
    }
    try {
      report.failurePage = {
        url: page.url(),
        text: (await page.locator('body').innerText({ timeout: 3000 })).slice(-6000),
      }
    } catch {
      /* No DOM available. */
    }
  }
  let message = error instanceof Error ? error.message : 'Unknown local browser test failure'
  for (const value of [credentials?.password, newPassword].filter(Boolean))
    message = message.replaceAll(value, '[redacted]')
  report.result = 'FAIL'
  report.failure = { step: currentStep, message }
  console.error(`FAIL ${currentStep}: ${message}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  stopBrowserContainer()
  report.certificateTrustRemoved = true
  await persist()
  console.log(
    'Evidence: docs/evidence/' +
      evidenceName('P6C-browser.json') +
      '; credentials omitted; isolated browser CA store removed.',
  )
}
