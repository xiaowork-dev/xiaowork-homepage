// 仅获取官方公开元数据；不安装依赖，不执行下载内容，不降低 TLS 校验。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

const output = 'docs/evidence/P6E-chain4-upstream.json'
assert.ok(!fs.existsSync(output), '禁止覆盖官方来源复核证据')
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex')
const ids = [
  'GHSA-3xf4-9g3c-4h4w',
  'GHSA-x287-wcfc-q46c',
  'GHSA-648h-gw55-m2g7',
  'GHSA-9v7c-q64q-vv33',
  'GHSA-3g3m-2fjr-6pw4',
  'GHSA-g3hv-75wg-m249',
  'GHSA-gcqx-w48m-w2h4',
]
const requests = [
  ...ids.map((id) => ({
    name: id,
    url: `https://api.github.com/advisories/${id}`,
    kind: 'advisory',
  })),
  ...['nuxt/4.6.3', 'glob/14.0.2', 'minimatch/11.0.1', 'deepmerge/latest', 'node-forge/1.4.1'].map(
    (entry) => ({ name: entry, url: 'https://registry.npmjs.org/' + entry, kind: 'npm' }),
  ),
  ...['3.24-stable', 'master'].flatMap((branch) =>
    ['APKBUILD', 'CVE-2026-107891.patch'].map((file) => ({
      name: `musl-${branch}-${file}`,
      url: `https://raw.githubusercontent.com/alpinelinux/aports/${branch}/main/musl/${file}`,
      kind: file === 'APKBUILD' ? 'apkbuild' : 'patch',
    })),
  ),
  { name: 'GO-2026-5932', url: 'https://vuln.go.dev/ID/GO-2026-5932.json', kind: 'go' },
]
const results = []
// 串行避免公开服务速率限制；失败只记为未验证，绝不等同于漏洞已解决。
for (const request of requests) {
  const result = { ...request, at: new Date().toISOString() }
  try {
    const response = await fetch(request.url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'XiaoWork-P6E-readonly-security-review' },
    })
    result.status = response.status
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.ok(bytes.length <= 4 << 20, '官方响应超出复核上限')
    result.bytes = bytes.length
    result.sha256 = hash(bytes)
    result.result = response.ok ? 'FETCHED' : 'HTTP_ERROR_NOT_VERIFIED'
    if (response.ok) {
      const text = bytes.toString('utf8')
      if (request.kind === 'advisory') {
        const value = JSON.parse(text)
        result.advisory = Object.fromEntries(
          [
            'ghsa_id',
            'cve_id',
            'summary',
            'severity',
            'published_at',
            'updated_at',
            'withdrawn_at',
            'vulnerabilities',
            'references',
          ].map((key) => [key, value[key]]),
        )
      } else if (request.kind === 'npm') {
        const value = JSON.parse(text)
        result.package = {
          name: value.name,
          version: value.version,
          gitHead: value.gitHead,
          repository: value.repository,
          integrity: value.dist?.integrity,
          engines: value.engines,
          dependencies: value.dependencies,
        }
      } else if (request.kind === 'apkbuild') {
        result.versionAndFix = text
          .split('\n')
          .filter((line) => /pkgver=|pkgrel=|CVE-2026-107891|df73a35b9da531/.test(line))
      } else if (request.kind === 'patch') {
        result.sha512 = hash(bytes, 'sha512')
      } else {
        const value = JSON.parse(text)
        result.advisory = {
          id: value.id,
          summary: value.summary,
          affected: value.affected,
          modified: value.modified,
          references: value.references,
        }
      }
    }
  } catch (error) {
    result.result = 'FETCH_FAILED_NOT_VERIFIED'
    result.error = error.message
  }
  results.push(result)
  console.log(request.name + ' ' + result.result)
}
const report = {
  date: new Date().toISOString(),
  source: '4f18eaeaecb86baaca01f148f388e7e86eec68bf',
  scope: '官方版本、公告和发行分支补丁复核；未安装或升级任何依赖',
  results,
}
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
if (results.some((entry) => entry.result !== 'FETCHED')) process.exitCode = 1
