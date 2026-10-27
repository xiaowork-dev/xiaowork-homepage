<script setup lang="ts">
import { computed } from 'vue'
import type { Profile } from '../lib/types'
import { useDraftDocument } from '../composables/useDraftDocument'
import AssetPicker from '../components/AssetPicker.vue'
import StringListField from '../components/StringListField.vue'
import ConflictPanel from '../components/ConflictPanel.vue'
import SaveBar from '../components/SaveBar.vue'

const {
  form,
  revision,
  dirty,
  loading,
  saving,
  error,
  success,
  conflict,
  remote,
  remoteRevision,
  load,
  save,
  inspectRemote,
  reapply,
} = useDraftDocument<Profile>('/profile', 'profile')
const githubUrl = computed({
  get: () => form.value?.site.githubUrl ?? '',
  set: (value: string) => {
    if (form.value) form.value.site.githubUrl = value || null
  },
})
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">IDENTITY & STORY</span>
        <h1>品牌与个人资料</h1>
        <p class="muted">介绍你的方向、能力与作品。只填写已经确认可以公开的内容。</p>
      </div>
    </header>
    <p v-if="loading" class="panel" role="status">正在读取资料…</p>
    <div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert--success" role="status">{{ success }}</div>
    <ConflictPanel
      v-if="conflict"
      :local="form"
      :remote="remote"
      :revision="remoteRevision"
      :busy="saving || loading"
      @inspect="inspectRemote"
      @reload="load"
      @reapply="reapply"
    />
    <p v-if="!loading && !form && !error" class="empty-state">
      尚未导入品牌资料。请先通过受控 CLI 完成内容初始化。
    </p>
    <button v-if="!form && error" class="button" type="button" @click="load">重新读取资料</button>
    <form v-if="form" class="stack" @submit.prevent="save">
      <fieldset class="form-lock" :disabled="loading || saving" :aria-busy="loading || saving">
        <section class="panel form-section">
          <div class="section-heading">
            <h2>品牌身份</h2>
            <p class="muted">首页展示的名称、角色和技术方向。</p>
          </div>
          <div class="form-grid">
            <label class="field"
              >品牌名称<input
                v-model="form.site.name"
                required
                maxlength="80"
                autocomplete="organization" /></label
            ><label class="field"
              >角色与定位<input v-model="form.site.role" required maxlength="120"
            /></label>
          </div>
          <StringListField
            v-model="form.site.introduction"
            label="首页介绍段落"
            :max="8"
            :maxlength="500"
            multiline
            help="与网站设置中的首页介绍共享同一份草稿内容。"
          />
          <div class="form-grid">
            <StringListField
              v-model="form.site.directions"
              label="技术方向"
              :max="10"
              :maxlength="40"
            /><StringListField
              v-model="form.site.technologies"
              label="技术标签"
              :max="30"
              :maxlength="40"
            />
          </div>
          <label class="field"
            >GitHub 公开地址（可选）<input
              v-model="githubUrl"
              type="url"
              inputmode="url"
              maxlength="2048"
              placeholder="填写已确认的 HTTPS 地址"
            /><span class="help-text">不从提交邮箱推断公开联系方式。</span></label
          >
          <div class="form-grid">
            <AssetPicker
              label="个人头像（可选）"
              :model-value="
                form.site.avatarAssetId ? { kind: 'media', id: form.site.avatarAssetId } : null
              "
              clearable
              @update:model-value="form.site.avatarAssetId = $event?.id ?? null"
            /><AssetPicker
              label="品牌图片（可选）"
              :model-value="
                form.site.brandAssetId ? { kind: 'media', id: form.site.brandAssetId } : null
              "
              clearable
              @update:model-value="form.site.brandAssetId = $event?.id ?? null"
            />
          </div>
        </section>
        <section class="panel form-section">
          <div class="section-heading">
            <h2>品牌与个人介绍</h2>
            <p class="muted">没有确认的履历可以留空，不需要补写工作经历或学历。</p>
          </div>
          <label class="field"
            >品牌介绍<textarea
              v-model="form.about.brandIntroduction"
              rows="4"
              required
              maxlength="1000"
            />
          </label>
          <StringListField
            v-model="form.about.personalIntroduction"
            label="个人介绍段落"
            :max="12"
            :maxlength="1000"
            multiline
          />
        </section>
        <section class="panel form-section">
          <div class="section-heading">
            <h2>技术能力</h2>
            <p class="muted">将已确认的技术按方向分组，最多 10 组。</p>
          </div>
          <fieldset
            v-for="(capability, index) in form.about.capabilities"
            :key="index"
            class="nested-fieldset"
          >
            <legend>能力组 {{ index + 1 }}</legend>
            <label class="field"
              >能力组名称<input v-model="capability.title" required maxlength="80" /></label
            ><StringListField
              v-model="capability.technologies"
              :label="`第${index + 1}组技术`"
              :max="30"
              :maxlength="40"
            /><button
              type="button"
              class="button button--ghost"
              :aria-label="`删除能力组${index + 1}`"
              @click="form.about.capabilities.splice(index, 1)"
            >
              删除此组
            </button>
          </fieldset>
          <button
            type="button"
            class="button button--secondary"
            :disabled="form.about.capabilities.length >= 10"
            @click="form.about.capabilities.push({ title: '', technologies: [] })"
          >
            ＋ 添加能力组
          </button>
        </section>
        <section class="panel form-section">
          <div class="section-heading">
            <h2>开发理念</h2>
            <p class="muted">用清晰的标题和说明表达做产品的原则。</p>
          </div>
          <fieldset
            v-for="(principle, index) in form.about.principles"
            :key="index"
            class="nested-fieldset"
          >
            <legend>开发理念 {{ index + 1 }}</legend>
            <label class="field"
              >理念标题<input v-model="principle.title" required maxlength="80" /></label
            ><label class="field"
              >理念说明<textarea
                v-model="principle.description"
                rows="2"
                required
                maxlength="500"
              /></label
            ><button
              type="button"
              class="button button--ghost"
              :aria-label="`删除开发理念${index + 1}`"
              @click="form.about.principles.splice(index, 1)"
            >
              删除此项
            </button>
          </fieldset>
          <button
            type="button"
            class="button button--secondary"
            :disabled="form.about.principles.length >= 10"
            @click="form.about.principles.push({ title: '', description: '' })"
          >
            ＋ 添加开发理念
          </button>
        </section>
        <section class="panel form-section">
          <div class="section-heading">
            <h2>公开联系方式</h2>
            <p class="muted">仅填写允许公开的 HTTPS 或 mailto 地址。最多 10 项。</p>
          </div>
          <fieldset
            v-for="(contact, index) in form.about.contacts"
            :key="index"
            class="nested-fieldset"
          >
            <legend>联系方式 {{ index + 1 }}</legend>
            <div class="form-grid">
              <label class="field"
                >显示名称<input v-model="contact.label" required maxlength="80" /></label
              ><label class="field"
                >公开联系地址<input v-model="contact.url" required maxlength="2048" inputmode="url"
              /></label>
            </div>
            <label class="field"
              >联系说明<textarea v-model="contact.description" rows="2" maxlength="300" /></label
            ><button
              type="button"
              class="button button--ghost"
              :aria-label="`删除联系方式${index + 1}`"
              @click="form.about.contacts.splice(index, 1)"
            >
              删除此项
            </button>
          </fieldset>
          <button
            type="button"
            class="button button--secondary"
            :disabled="form.about.contacts.length >= 10"
            @click="form.about.contacts.push({ label: '', description: '', url: '' })"
          >
            ＋ 添加联系方式
          </button>
        </section>
        <section class="panel form-section">
          <h2>简历入口（可选）</h2>
          <p class="muted">未准备好可公开的简历时，保持不提供。</p>
          <div v-if="form.about.resume" class="stack">
            <div class="form-grid">
              <label class="field"
                >简历按钮文字<input
                  v-model="form.about.resume.label"
                  required
                  maxlength="80" /></label
              ><label class="field"
                >简历 HTTPS 地址<input
                  v-model="form.about.resume.url"
                  type="url"
                  inputmode="url"
                  required
                  maxlength="2048"
              /></label>
            </div>
            <button type="button" class="button button--ghost" @click="form.about.resume = null">
              移除简历入口
            </button>
          </div>
          <button
            v-else
            type="button"
            class="button button--secondary"
            @click="form.about.resume = { label: '', url: '' }"
          >
            添加简历入口
          </button>
        </section>
        <SaveBar :dirty="dirty" :saving="saving" :revision="revision" @reload="load" />
      </fieldset>
    </form>
  </div>
</template>
