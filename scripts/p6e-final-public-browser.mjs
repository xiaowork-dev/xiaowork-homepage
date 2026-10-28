// Fresh public interaction regression on the final group, trusted HTTPS only.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const env = await import(
  pathToFileURL(path.resolve('.cache/p6e-final-harness/p6e-browser-environment.mjs')).href
)
const { chromium } = createRequire(path.resolve('admin/package.json'))('playwright-core')
const spec = JSON.parse(await readFile('docs/evidence/P6E-final-runtime-manifest.json', 'utf8'))
process.env.V11_SOURCE_REVISION = spec.source
process.env.V11_BUILDER_ID = spec.images.worker.id
process.env.V11_LOCAL_PUBLISH = '1'
const report = {
  date: new Date().toISOString(),
  source: spec.source,
  project: env.project,
  cases: [],
  errors: [],
  failedResources: [],
  result: 'RUNNING',
}
const browser = await chromium.connect(
  await env.startBrowserContainer(path.resolve('.cache/p6e-closure-browser/ca.crt'), true),
)
const record = (name) => report.cases.push({ name, result: 'PASS' })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: false,
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('console', (msg) => {
    if (/hydration|mismatch|content security policy|uncaught/i.test(msg.text()))
      report.errors.push(msg.text())
  })
  page.on('response', (res) => {
    if (
      res.status() >= 400 &&
      ['script', 'stylesheet', 'image'].includes(res.request().resourceType())
    )
      report.failedResources.push({ path: new URL(res.url()).pathname, status: res.status() })
  })
  await page.goto(env.origin + '/projects/')
  await page.locator('.project-card h2').first().waitFor()
  const names = await page.locator('.project-card h2').allTextContents()
  assert.ok(names.length >= 3)
  await page.getByLabel('项目名称、简介或技术栈', { exact: true }).fill(names[0].trim())
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.project-card').length === 1)
  assert.equal((await page.locator('.project-card h2').innerText()).trim(), names[0].trim())
  await page.reload()
  await page.waitForFunction(() => document.querySelectorAll('.project-card').length === 1)
  record('Search and direct-query reload retain exact filtered content')
  await page.getByLabel('项目名称、简介或技术栈', { exact: true }).fill('P6E-no-match-final-unique')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('heading', { name: '没有找到匹配的项目' }).waitFor()
  await page.getByRole('button', { name: '查看全部项目', exact: true }).click()
  await page.waitForFunction(
    (count) => document.querySelectorAll('.project-card').length === count,
    names.length,
  )
  assert.equal(
    await page.getByLabel('项目名称、简介或技术栈').evaluate((el) => el === document.activeElement),
    true,
  )
  record('Empty state reset restores all cards and keyboard focus')
  const category = page.locator('.category-filter').nth(1)
  await category.click()
  await page.waitForFunction(() => new URL(location.href).searchParams.has('category'))
  assert.equal(await category.getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '重置筛选', exact: true }).click()
  await page.locator('#project-sort').selectOption('name-asc')
  await page.waitForFunction(() => new URL(location.href).searchParams.get('sort') === 'name-asc')
  const ascending = await page.locator('.project-card h2').allTextContents()
  await page.locator('#project-sort').selectOption('name-desc')
  await page.waitForFunction(() => new URL(location.href).searchParams.get('sort') === 'name-desc')
  assert.deepEqual(
    await page.locator('.project-card h2').allTextContents(),
    [...ascending].reverse(),
  )
  await page.goBack()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('sort') === 'name-asc')
  assert.deepEqual(await page.locator('.project-card h2').allTextContents(), ascending)
  record('Real category, sort and browser-back query state')
  await page.setViewportSize({ width: 320, height: 800 })
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  const nav = page.getByRole('navigation', { name: '移动端导航', exact: true })
  await nav.getByRole('link', { name: '关于', exact: true }).click()
  await page.waitForURL(/\/about\/?$/)
  assert.equal(await nav.count(), 0)
  await page.getByRole('button', { name: '切换深色或浅色主题' }).click()
  const theme = await page.locator('html').getAttribute('data-theme')
  await page.reload()
  assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page
    .getByRole('navigation', { name: '移动端导航' })
    .getByRole('link', { name: '首页', exact: true })
    .focus()
  await page.keyboard.press('Escape')
  assert.equal(
    await page
      .getByRole('button', { name: '菜单', exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  )
  record('320px mobile menu routes, Escape focus and theme persistence')
  assert.equal(await page.locator('a[href="#"],a[href^="javascript:"]').count(), 0)
  assert.ok(
    await page
      .locator('a[target="_blank"]')
      .evaluateAll((links) => links.every((a) => /noopener/.test(a.rel))),
  )
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.failedResources, [])
  record('No inert links, unsafe external targets, hydration errors or failed assets')
  await page.screenshot({
    path: 'docs/evidence/P6E-final-public-interactions-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.failure = error.message
  process.exitCode = 1
} finally {
  await browser.close()
  env.stopBrowserContainer()
  await writeFile(
    'docs/evidence/P6E-final-public-interactions.json',
    JSON.stringify(report, null, 2) + '\n',
  )
}
