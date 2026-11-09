import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const dir = new URL('../deploy/v11-production/', import.meta.url)
const read = (name) => readFileSync(new URL(name, dir), 'utf8')
const shells = ['prod-setup.sh', 'v11-backup.sh', 'cutover.sh', 'rollback-v10.sh']

test(
  'production launch shell scripts parse',
  { skip: spawnSync('bash', ['--version']).status !== 0 && 'bash unavailable' },
  () => {
    for (const name of shells) {
      const r = spawnSync('bash', ['-n', '-'], { input: read(name) })
      assert.equal(r.status, 0, `${name}: ${r.stderr}`)
    }
  },
)

test('shadow deployment stays on loopback, pins the accepted release and never touches OpenResty', () => {
  const s = read('prod-setup.sh')
  assert.match(s, /S=c81af02da2c40104804cba33fd0146de3dd0980b/)
  assert.match(s, /--topology openresty --http-port 3110/)
  assert.match(s, /REFUSE: \$PT already exists/)
  assert.match(s, /sha256sum -c -/, 'Node tarball must be checked against the official list')
  assert.doesNotMatch(s, /1panel|openresty -s|proxy_pass/i)
  assert.doesNotMatch(s, /prune|rm -rf|volume rm/)
})

test('cutover only swaps the V1.0 upstream and reverts automatically on any failed check', () => {
  const s = read('cutover.sh')
  assert.match(
    s,
    /grep -q 'proxy_pass http:\/\/127\.0\.0\.1:3100;'/,
    'refuses unless the current upstream is V1.0',
  )
  assert.match(
    s,
    /s#proxy_pass http:\/\/127\.0\.0\.1:3100;#proxy_pass http:\/\/127\.0\.0\.1:3110;#/,
  )
  assert.match(s, /cp -p \$F \$SAVE/, 'original saved before editing')
  assert.match(s, /openresty -t[^\n]*\|\| revert/)
  assert.match(s, /\[ "\$code" = 200 \] \|\| revert/)
  assert.match(s, /\[ "\$code" = 401 \] \|\| revert/)
  const r = read('rollback-v10.sh')
  assert.match(
    r,
    /grep -q 'proxy_pass http:\/\/127\.0\.0\.1:3100;' \$SAVE/,
    'rollback restores only a verified V1.0 copy',
  )
})

test('daily backup never deletes and refuses on low disk; timer runs once a day', () => {
  const s = read('v11-backup.sh')
  assert.doesNotMatch(s, /\brm\b|find [^\n]*-delete/)
  assert.match(s, /-lt 2048/)
  assert.match(s, /v11-release\.mjs backup --project \$P --backup \$B/)
  assert.match(read('xiaowork-homepage-v11-backup.timer'), /OnCalendar=\*-\*-\* 19:30:00 UTC/)
  assert.match(
    read('xiaowork-homepage-v11-backup.service'),
    /ExecStart=\/opt\/xiaowork-homepage-v11\/bin\/v11-backup\.sh/,
  )
})
