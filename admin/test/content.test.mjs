import assert from 'node:assert/strict'
import test from 'node:test'
import { moveItem, projectInput, validateImageFile } from '../src/lib/content.ts'

test('项目编辑DTO保留占位真实性并剔除只读字段', () => {
  const initial = projectInput(undefined, 'website')
  assert.equal(initial.status, 'unconfirmed')
  assert.equal(initial.isPlaceholder, true)
  assert.equal(initial.visible, false)
  assert.equal(initial.demoUrl, null)
  assert.equal(initial.repositoryUrl, null)
  assert.deepEqual(initial.techStack, [])
  const project = {
    ...initial,
    id: 'prj_test',
    order: 5,
    archivedAt: null,
    createdAt: 'now',
    updatedAt: 'now',
  }
  const input = projectInput(project)
  assert.equal(Object.hasOwn(input, 'id'), false)
  assert.equal(Object.hasOwn(input, 'order'), false)
  assert.equal(Object.hasOwn(input, 'archivedAt'), false)
  input.cover.id = 'changed'
  input.techStack.push('Reviewed technology')
  assert.equal(project.cover.id, '')
  assert.deepEqual(project.techStack, [])
})

test('排序移动保留完整集合且不就地修改原始基准', () => {
  const original = ['first', 'second', 'third', 'fourth']
  const next = moveItem(original, 0, 3)
  assert.deepEqual(next, ['second', 'third', 'fourth', 'first'])
  assert.deepEqual([...next].sort(), [...original].sort())
  assert.deepEqual(original, ['first', 'second', 'third', 'fourth'])
  assert.deepEqual(moveItem(original, -1, 0), original)
  assert.deepEqual(moveItem(original, 0, 10), original)
})

test('图片客户端拒绝超大、空文件、未支持格式及伪造声明', async () => {
  await assert.rejects(
    validateImageFile(new File([], 'empty.png', { type: 'image/png' })),
    /不超过 10 MiB/,
  )
  await assert.rejects(
    validateImageFile(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    ),
    /不超过 10 MiB/,
  )
  await assert.rejects(
    validateImageFile(new File(['svg'], 'image.svg', { type: 'image/svg+xml' })),
    /仅支持/,
  )
  await assert.rejects(
    validateImageFile(new File(['not a png'], 'image.png', { type: 'image/png' })),
    /内容与声明格式不符/,
  )
})

test('图片尺寸边界先于上传且解码资源始终释放', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
  let width = 5000
  let height = 5000
  let closed = 0
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({
      width,
      height,
      close: () => {
        closed++
      },
    }),
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous)
    else delete globalThis.createImageBitmap
  })
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], 'safe.png', {
    type: 'image/png',
  })
  assert.deepEqual(await validateImageFile(file), { width: 5000, height: 5000 })
  height = 5001
  await assert.rejects(validateImageFile(file), /2,500 万/)
  width = 8193
  height = 10
  await assert.rejects(validateImageFile(file), /8,192/)
  assert.equal(closed, 3)
})
