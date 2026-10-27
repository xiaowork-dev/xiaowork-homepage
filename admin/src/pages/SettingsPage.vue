<script setup lang="ts">
import type { Settings } from '../lib/types'
import { admin } from '../lib/admin'
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
} = useDraftDocument<Settings>('/settings', 'settings')
const pages = [
  { key: 'home', label: '首页', path: '/' },
  { key: 'projects', label: '全部项目', path: '/projects' },
  { key: 'about', label: '关于我', path: '/about' },
] as const
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">SITE & DISCOVERY</span>
        <h1>网站与 SEO 设置</h1>
        <p class="muted">管理站点文案和分享信息。保存草稿不会立即修改公开页面。</p>
      </div>
    </header>
    <p v-if="loading" class="panel" role="status">正在读取网站设置…</p>
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
      尚未导入网站设置。请先通过受控 CLI 初始化内容。
    </p>
    <button v-if="!form && error" class="button" type="button" @click="load">重新读取设置</button>
    <form v-if="form" class="stack" @submit.prevent="save">
      <fieldset class="form-lock" :disabled="loading || saving" :aria-busy="loading || saving">
        <section class="panel form-section">
          <h2>网站基础信息</h2>
          <div class="origin-info">
            <span class="muted">正式主域 · 只读</span
            ><strong>{{ admin.workspace.value?.origin ?? 'https://xiaoworks.com' }}</strong>
            <p class="help-text">服务器、域名、反向代理和环境变量不在内容编辑范围。</p>
          </div>
          <label class="field"
            >网站标题<input v-model="form.siteTitle" required maxlength="100" /></label
          ><label class="field"
            >网站描述<textarea
              v-model="form.siteDescription"
              rows="3"
              required
              maxlength="300"
            /></label
          ><label class="field"
            >默认 SEO 描述<textarea
              v-model="form.defaultSeoDescription"
              rows="3"
              required
              maxlength="300"
            />
          </label>
          <AssetPicker
            label="默认分享图片（可选）"
            :model-value="
              form.defaultShareAssetId ? { kind: 'media', id: form.defaultShareAssetId } : null
            "
            clearable
            @update:model-value="form.defaultShareAssetId = $event?.id ?? null"
          />
        </section>
        <section class="panel form-section">
          <h2>首页与页脚</h2>
          <StringListField
            v-model="form.homeIntroduction"
            label="首页介绍段落"
            :max="8"
            :maxlength="500"
            multiline
            help="与品牌资料中的首页介绍共享同一字段。其他标签页的更新仍会触发版本冲突保护。"
          /><label class="field"
            >页脚文字（可选）<textarea v-model="form.footerText" rows="2" maxlength="300" /><span
              class="help-text"
              >使用纯文本。年份由后续静态渲染器生成。</span
            ></label
          >
        </section>
        <section class="panel form-section">
          <h2>公开社交链接</h2>
          <p class="muted">仅添加已经确认的公开 HTTPS 地址，最多 10 项。</p>
          <fieldset v-for="(link, index) in form.socialLinks" :key="index" class="nested-fieldset">
            <legend>社交链接 {{ index + 1 }}</legend>
            <div class="form-grid">
              <label class="field"
                >链接名称<input v-model="link.label" maxlength="80" required /></label
              ><label class="field"
                >社交 HTTPS 地址<input
                  v-model="link.url"
                  type="url"
                  inputmode="url"
                  maxlength="2048"
                  required
              /></label>
            </div>
            <button
              type="button"
              class="button button--ghost"
              :aria-label="`删除社交链接${index + 1}`"
              @click="form.socialLinks.splice(index, 1)"
            >
              删除此项
            </button>
          </fieldset>
          <button
            type="button"
            class="button button--secondary"
            :disabled="form.socialLinks.length >= 10"
            @click="form.socialLinks.push({ label: '', url: '' })"
          >
            ＋ 添加社交链接
          </button>
        </section>
        <section class="panel form-section">
          <h2>逐页 SEO 与分享</h2>
          <p class="muted">
            留空使用站点默认文案；分享图片按页面图片、默认图片、仓库品牌图依次回退。
          </p>
          <fieldset v-for="page in pages" :key="page.key" class="nested-fieldset">
            <legend>
              {{ page.label }} <span class="muted">{{ page.path }}</span>
            </legend>
            <label class="field"
              >{{ page.label }}标题<input
                v-model="form.pages[page.key].title"
                maxlength="100"
                placeholder="留空使用默认标题" /></label
            ><label class="field"
              >{{ page.label }}描述<textarea
                v-model="form.pages[page.key].description"
                rows="3"
                maxlength="300"
                placeholder="留空使用默认 SEO 描述"
              /></label
            ><AssetPicker
              :label="`${page.label}分享图片（可选）`"
              :model-value="
                form.pages[page.key].shareAssetId
                  ? { kind: 'media', id: form.pages[page.key].shareAssetId! }
                  : null
              "
              clearable
              @update:model-value="form.pages[page.key].shareAssetId = $event?.id ?? null"
            />
          </fieldset>
        </section>
        <SaveBar :dirty="dirty" :saving="saving" :revision="revision" @reload="load" />
      </fieldset>
    </form>
  </div>
</template>
