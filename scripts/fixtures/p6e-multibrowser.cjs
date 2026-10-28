// Isolated P6-E browser sidecar only. No account or session credentials.
const { firefox, webkit } = require('/test-deps/playwright-core')
const { execFileSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')

const report = {
  date: new Date().toISOString(),
  scope: 'Local P6-E Docker gateway only; public routes and unauthenticated admin checks',
  tlsVerificationDisabled: false,
  hostTrustStoreModified: false,
  browsers: [],
  limitations: [
    'Firefox and WebKit do not repeat the credentialed Chromium management workflow.',
    'These Linux browser engines are not physical iOS Safari or Android hardware.',
  ],
}
const publicOrigin = 'http://127.0.0.1:8080'
// The P6-E test override changes both the internal TLS listener and host port.
const adminOrigin = 'https://localhost:3447'
const widths = [320, 390, 768, 1024, 1440]
mkdirSync('/evidence', { recursive: true })

;(async () => {
  for (const [name, engine] of [
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    const entry = { name, cases: [], errors: [], tls: 'NOT_RUN' }
    report.browsers.push(entry)
    let context
    try {
      const profile = `/tmp/p6e-${name}`
      mkdirSync(profile, { recursive: true })
      // Firefox consumes the trusted CA in its own temporary profile. The
      // WebKit run deliberately tests its actual store without TLS bypasses.
      if (name === 'firefox') {
        execFileSync('certutil', ['-N', '--empty-password', '-d', 'sql:' + profile])
        execFileSync('certutil', [
          '-A',
          '-d',
          'sql:' + profile,
          '-n',
          'P6E isolated CA',
          '-t',
          'C,,',
          '-i',
          '/ca.crt',
        ])
      }
      context = await engine.launchPersistentContext(profile, {
        headless: true,
        ignoreHTTPSErrors: false,
      })
      const page = await context.newPage()
      page.on('pageerror', (error) => entry.errors.push(error.message))
      page.on('console', (message) => {
        if (/hydration|mismatch|content security policy|uncaught/i.test(message.text()))
          entry.errors.push(message.text())
      })
      await page.goto(publicOrigin, { waitUntil: 'networkidle' })
      for (const theme of ['dark', 'light']) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await page.evaluate((value) => localStorage.setItem('xiaowork-theme', value), theme)
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 })
          for (const route of ['/', '/projects', '/about']) {
            const response = await page.goto(publicOrigin + route, { waitUntil: 'networkidle' })
            assert.equal(response.status(), 200)
            assert.equal(await page.locator('h1').count(), 1)
            await page.locator('h1').waitFor()
            assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth > window.innerWidth,
            )
            assert.equal(overflow, false, `${name} ${theme} ${width} ${route}`)
            entry.cases.push({ theme, width, route, result: 'PASS' })
          }
        }
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(publicOrigin, { waitUntil: 'networkidle' })
      await page.screenshot({ path: `/evidence/P6E-${name}-mobile.png`, fullPage: true })
      try {
        const response = await page.goto(adminOrigin + '/admin/login', {
          waitUntil: 'networkidle',
        })
        assert.equal(response.status(), 200)
        await page.getByRole('button', { name: '安全登录' }).waitFor()
        // Use the browser's verified TLS connection and its own trusted CA.
        // Playwright's separate Node APIRequestContext has a different store.
        const denied = await page.evaluate(async () => {
          const response = await fetch('/api/admin/v1/workspace', { cache: 'no-store' })
          return { status: response.status, cacheControl: response.headers.get('cache-control') }
        })
        assert.equal(denied.status, 401)
        assert.match(denied.cacheControl, /no-store/)
        entry.tls = 'PASS'
        entry.adminUnauthorized = 401
      } catch (error) {
        entry.tls = 'NOT_PASSED'
        entry.tlsError = error.message.split('\n')[0]
      }
      assert.equal(entry.errors.length, 0, `${name} browser console errors`)
      entry.result = 'PASS_PUBLIC_ROUTES'
    } catch (error) {
      entry.result = 'FAIL'
      entry.error = error.message.split('\n')[0]
      process.exitCode = 1
    } finally {
      await context?.close()
    }
  }
  writeFileSync('/evidence/P6E-multibrowser.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
})().catch(() => {
  writeFileSync('/evidence/P6E-multibrowser.json', JSON.stringify(report, null, 2) + '\n')
  console.error('Local multibrowser verification failed; no credential data collected')
  process.exitCode = 1
})
