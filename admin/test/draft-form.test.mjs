import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick } from 'vue'
import { admin } from '../src/lib/admin.ts'
import { ApiError } from '../src/lib/api.ts'
import { useDraftDocument } from '../src/composables/useDraftDocument.ts'
import {
  allowNextNavigation,
  confirmUnsavedChanges,
  hasUnsavedChanges,
} from '../src/composables/useUnsavedChanges.ts'

// Mount the actual Vue lifecycle without adding a browser/DOM implementation.
// Browser routing, native dialogs and beforeunload have separate HTTPS E2E.
const renderer = createRenderer({
  createElement: (tag) => ({ tag, children: [] }),
  createText: (text) => ({ text }),
  createComment: (text) => ({ text }),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
  },
  parentNode: (node) => node.parent,
  nextSibling: () => null,
  insert: (node, parent) => {
    node.parent = parent
    parent.children.push(node)
  },
  remove: (node) => {
    const children = node.parent?.children
    if (children) children.splice(children.indexOf(node), 1)
  },
  patchProp: () => {},
})
const document = () => ({
  site: { name: '已读取名称', introduction: ['已确认介绍'] },
  about: { contacts: [] },
})
const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function mount(t) {
  const original = {
    get: admin.get,
    write: admin.write,
    window: globalThis.window,
    workspace: admin.workspace.value,
  }
  const window = Object.assign(new EventTarget(), { confirm: () => true })
  globalThis.window = window
  admin.get = async () => ({ profile: document(), revision: 'ws-7' })
  let draft
  const app = renderer.createApp({
    setup() {
      draft = useDraftDocument('/profile', 'profile')
      return () => null
    },
  })
  app.mount({ children: [] })
  t.after(() => {
    app.unmount()
    admin.get = original.get
    admin.write = original.write
    admin.workspace.value = original.workspace
    if (original.window === undefined) delete globalThis.window
    else globalThis.window = original.window
    assert.equal(hasUnsavedChanges(), false, 'unmounted forms must leave no stale navigation guard')
  })
  await settle()
  return { draft, window }
}

test('nested form edits become dirty and unrelated workspace refresh never destroys inputs', async (t) => {
  const { draft, window } = await mount(t)
  assert.equal(draft.dirty.value, false)
  draft.form.value.site.name = '本页未保存输入'
  draft.form.value.site.introduction.push('新段落')
  await nextTick()
  assert.equal(draft.dirty.value, true)
  assert.equal(hasUnsavedChanges(), true)
  window.confirm = () => false
  assert.equal(confirmUnsavedChanges(), false)
  await draft.load()
  assert.equal(
    draft.form.value.site.name,
    '本页未保存输入',
    'cancelled reload must preserve nested input',
  )
  admin.workspace.value = { revision: 'ws-999' }
  assert.equal(draft.form.value.site.name, '本页未保存输入')
  assert.equal(draft.revision.value, 'ws-7', 'global refresh cannot silently rebase a form')
  allowNextNavigation()
  assert.equal(confirmUnsavedChanges(), true)
  assert.equal(
    confirmUnsavedChanges(),
    false,
    'explicit logout approval only bypasses one navigation',
  )
})

test('409 preserves input and baseline; remote comparison needs explicit approval before reapply', async (t) => {
  const { draft, window } = await mount(t)
  draft.form.value.site.name = '希望保留的编辑'
  const writes = []
  admin.write = async (_method, _path, value, revision) => {
    writes.push({ value: structuredClone(value), revision })
    if (writes.length === 1) throw new ApiError(409, 'REVISION_CONFLICT', '远端已经修改', 'ws-8')
    return { profile: value, revision: 'ws-9' }
  }
  await draft.save()
  assert.equal(writes.length, 1, 'conflicting saves are never retried automatically')
  assert.equal(draft.conflict.value, true)
  assert.equal(draft.form.value.site.name, '希望保留的编辑')
  assert.equal(draft.revision.value, 'ws-7')
  admin.get = async () => ({
    profile: { ...document(), site: { ...document().site, name: '其他标签页编辑' } },
    revision: 'ws-8',
  })
  await draft.inspectRemote()
  assert.equal(draft.remote.value.site.name, '其他标签页编辑')
  assert.equal(draft.form.value.site.name, '希望保留的编辑')
  window.confirm = () => false
  await draft.reapply()
  assert.equal(writes.length, 1)
  assert.equal(draft.revision.value, 'ws-7')
  window.confirm = () => true
  await draft.reapply()
  assert.equal(writes[1].revision, 'ws-8')
  assert.equal(writes[1].value.site.name, '希望保留的编辑')
  assert.equal(draft.revision.value, 'ws-9')
  assert.equal(draft.dirty.value, false)
})

test('401 and re-login retain a dirty form and explicitly surface changed remote revision', async (t) => {
  const { draft, window } = await mount(t)
  draft.form.value.site.name = '过期前的未保存输入'
  let writes = 0
  admin.write = async () => {
    writes++
    throw new ApiError(401, 'AUTH_REQUIRED', '需要重新登录')
  }
  await draft.save()
  assert.equal(draft.form.value.site.name, '过期前的未保存输入')
  assert.equal(draft.revision.value, 'ws-7')
  window.dispatchEvent(
    new CustomEvent('xiaowork:session-restored', { detail: { revision: 'ws-10' } }),
  )
  assert.equal(draft.conflict.value, true)
  assert.match(draft.error.value, /重新登录后.*版本已改变/)
  assert.equal(draft.revision.value, 'ws-7')
  assert.equal(writes, 1, 're-login does not resubmit or overwrite retained input')
})

test('pending document saves and reloads exclude duplicate or overlapping operations', async (t) => {
  const { draft } = await mount(t)
  draft.form.value.site.name = '本次保存内容'
  let finishWrite,
    savedPayload,
    writes = 0,
    reads = 0
  admin.write = async (_method, _path, body) => {
    writes++
    savedPayload = body
    return await new Promise((resolve) => {
      finishWrite = resolve
    })
  }
  admin.get = async () => {
    reads++
    return { profile: document(), revision: 'ws-10' }
  }
  const pendingSave = draft.save()
  assert.equal(draft.saving.value, true)
  await draft.save()
  await draft.load()
  await draft.inspectRemote()
  assert.equal(writes, 1)
  assert.equal(reads, 0)
  finishWrite({ profile: savedPayload, revision: 'ws-8' })
  await pendingSave
  assert.equal(draft.saving.value, false)
  assert.equal(draft.dirty.value, false)
  let finishRead
  admin.get = async () => {
    reads++
    return await new Promise((resolve) => {
      finishRead = resolve
    })
  }
  const pendingRead = draft.load()
  assert.equal(draft.loading.value, true)
  await draft.load()
  await draft.save()
  assert.equal(reads, 1)
  assert.equal(writes, 1)
  finishRead({ profile: document(), revision: 'ws-10' })
  await pendingRead
  assert.equal(draft.loading.value, false)
  assert.equal(draft.revision.value, 'ws-10')
})
