import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
const file = 'docs/evidence/P6E-barrier-environment.json'
assert.ok(!fs.existsSync(file))
const commands = []
function run(executable, args, utf16 = false) {
  const r = spawnSync(executable, args, { timeout: 30000 })
  const item = {
    executable,
    args,
    exitCode: r.status,
    error: r.error?.message,
    stdout: r.stdout?.toString(utf16 ? 'utf16le' : 'utf8'),
    stderr: r.stderr?.toString(utf16 ? 'utf16le' : 'utf8'),
  }
  commands.push(item)
  return item.stdout
}
const daemon = JSON.parse(
  run('docker', [
    'info',
    '--format',
    '{"ID":{{json .ID}},"Name":{{json .Name}},"OperatingSystem":{{json .OperatingSystem}},"Memory":{{json .MemTotal}},"Kernel":{{json .KernelVersion}}}',
  ]),
)
const context = run('docker', ['context', 'show'])
run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
run('wsl', ['--list', '--verbose'], true)
run('wsl', ['--version'], true)
run('wsl', ['--list', '--online'], true)
const disk = {}
for (const p of ['C:/', 'D:/']) {
  const s = fs.statfsSync(p)
  disk[p] = { available: s.bavail * s.bsize, total: s.blocks * s.bsize }
}
fs.writeFileSync(
  file,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      cpu: os.cpus().length,
      memory: os.totalmem(),
      disk,
      daemon,
      context,
      commands,
      installedAnything: false,
      changedContext: false,
      nativeLinuxEngine: 'NOT_AVAILABLE',
      volumeCIMProbe: '无法访问 CIM 资源；容量改用 fs.statfs 实查。',
      earlierInlineController:
        'PowerShell 引号导致 Node SyntaxError，未执行系统检查；本文件控制器替代该错误调用。',
    },
    null,
    2,
  ) + '\n',
)
console.log(file)
