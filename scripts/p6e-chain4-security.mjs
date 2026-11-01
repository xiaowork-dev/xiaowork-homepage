// 复用已有逐镜像/精确源码扫描器，只隔离本轮输出，不改写旧报告或运行身份。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const reportFile = 'docs/evidence/P6E-chain4-security-invocation.json'
assert.ok(!fs.existsSync(reportFile), '禁止覆盖既有扫描执行记录')
const originalFile = 'scripts/p6e-chain3-security.mjs'
const original = fs.readFileSync(originalFile, 'utf8')
const cache = path.resolve('.cache/p6e-chain4-review')
fs.mkdirSync(cache, { recursive: true })
const replacements = [
  [
    "from './v11-maintenance.mjs'",
    `from '${pathToFileURL(path.resolve('scripts/v11-maintenance.mjs')).href}'`,
  ],
  ['.cache/p6e-chain3-security', '.cache/p6e-chain4-security'],
  ['P6E-chain3-security-audit.json', 'P6E-chain4-security-audit.json'],
  ['P6E-chain3-image-', 'P6E-chain4-image-'],
  ['P6E-chain3-govuln-', 'P6E-chain4-govuln-'],
]
let generated = original
for (const [before, after] of replacements) {
  assert.ok(generated.includes(before))
  generated = generated.replaceAll(before, after)
}
const controller = path.join(cache, 'security.mjs')
fs.writeFileSync(controller, generated, { flag: 'wx' })
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const invocation = {
  date: new Date().toISOString(),
  originalFile,
  originalSHA256: hash(original),
  generatedSHA256: hash(generated),
  replacements,
  note: '仅替换审计输出路径和 import 定位；发行 manifest、镜像/Schema/源码/权限断言保持原文。',
  operations: [],
}
const child = spawnSync(process.execPath, [controller], { stdio: 'inherit', timeout: 1500000 })
invocation.operations.push({
  executable: 'node',
  args: [controller],
  exitCode: child.status,
  signal: child.signal,
  error: child.error?.message,
})
// 独立 npm 审计。audit 非零原样保留，不能把扫描器执行成功解释成无风险。
for (const directory of ['.', 'admin']) {
  const cwd = path.resolve(directory)
  const file = `docs/evidence/P6E-chain4-${directory === '.' ? 'npm' : 'admin'}-audit.json`
  assert.ok(!fs.existsSync(file))
  const npmCLI = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const result = spawnSync(
    process.execPath,
    [npmCLI, 'audit', '--json', '--registry=https://registry.npmjs.org'],
    { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 16 << 20 },
  )
  fs.writeFileSync(file, result.stdout ?? '', { flag: 'wx' })
  let counts
  try {
    counts = JSON.parse(result.stdout).metadata?.vulnerabilities
  } catch {
    /* 原始错误仍保留 */
  }
  invocation.operations.push({
    executable: 'node npm-cli.js',
    cwd: directory,
    args: ['audit', '--json', '--registry=https://registry.npmjs.org'],
    exitCode: result.status,
    signal: result.signal,
    stderr: result.stderr,
    error: result.error?.message,
    file,
    sha256: hash(fs.readFileSync(file)),
    counts,
  })
}
invocation.runtimeChanges = false
invocation.completedAt = new Date().toISOString()
fs.writeFileSync(reportFile, JSON.stringify(invocation, null, 2) + '\n', { flag: 'wx' })
console.log(
  JSON.stringify(
    invocation.operations.map(({ exitCode, counts, file }) => ({ exitCode, counts, file })),
  ),
)
assert.equal(child.status, 0, '镜像/Go扫描未完成，不能引用旧结果冒充本轮成功')
// 取证时记录当前 Git，不能将文档/控制器 HEAD 冒称运行源码。
console.log(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
