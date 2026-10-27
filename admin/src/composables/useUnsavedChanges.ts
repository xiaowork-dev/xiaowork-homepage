import { onBeforeUnmount, type Ref } from 'vue'

const forms = new Map<symbol, Readonly<Ref<boolean>>>()
let approvedNavigation = false

export function useUnsavedChanges(dirty: Readonly<Ref<boolean>>) {
  const key = Symbol('draft-form')
  forms.set(key, dirty)
  onBeforeUnmount(() => forms.delete(key))
}

export function hasUnsavedChanges() {
  return [...forms.values()].some((dirty) => dirty.value)
}

export function confirmUnsavedChanges() {
  if (approvedNavigation) {
    approvedNavigation = false
    return true
  }
  return (
    !hasUnsavedChanges() || window.confirm('当前有未保存的修改。离开将丢弃这些输入，确定继续吗？')
  )
}

export function allowNextNavigation() {
  approvedNavigation = true
}
