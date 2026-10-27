<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: string[]
    label: string
    max: number
    maxlength: number
    multiline?: boolean
    help?: string
  }>(),
  { multiline: false, help: '' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
function update(index: number, event: Event) {
  const items = [...props.modelValue]
  items[index] = (event.target as HTMLInputElement).value
  emit('update:modelValue', items)
}
</script>

<template>
  <fieldset class="list-field">
    <legend>{{ label }}</legend>
    <p v-if="help" class="help-text">{{ help }}</p>
    <div v-for="(item, index) in modelValue" :key="index" class="list-row">
      <label class="sr-only" :for="`${label}-${index}`">{{ label }} {{ index + 1 }}</label>
      <textarea
        v-if="multiline"
        :id="`${label}-${index}`"
        :value="item"
        :maxlength="maxlength"
        rows="2"
        required
        @input="update(index, $event)"
      />
      <input
        v-else
        :id="`${label}-${index}`"
        :value="item"
        :maxlength="maxlength"
        required
        @input="update(index, $event)"
      />
      <button
        class="button button--ghost"
        type="button"
        :aria-label="`删除${label}第${index + 1}项`"
        @click="
          emit(
            'update:modelValue',
            modelValue.filter((_, i) => i !== index),
          )
        "
      >
        删除
      </button>
    </div>
    <p v-if="!modelValue.length" class="help-text">尚未填写。只添加已确认可以公开的信息。</p>
    <button
      class="button button--secondary"
      type="button"
      :disabled="modelValue.length >= max"
      @click="emit('update:modelValue', [...modelValue, ''])"
    >
      ＋ 添加{{ label }}
    </button>
    <span class="help-text"> {{ modelValue.length }} / {{ max }}</span>
  </fieldset>
</template>
