<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NSpin, NTag } from 'naive-ui'
import DOMPurify from 'dompurify'
import type { MailDetail, MailSummary } from '../../shared/types'
import { fileSize, formatTime } from '../utils'

const props = defineProps<{ selected: MailSummary | null; detail: MailDetail | null; loading: boolean }>()
const emit = defineEmits<{ back: []; markRead: []; download: [id: string] }>()
const safeHtml = computed(() => {
  if (!props.detail?.htmlBody) return ''
  return DOMPurify.sanitize(props.detail.htmlBody, { FORBID_TAGS: ['script','style','iframe','object','embed','form','input','button','video','audio'], FORBID_ATTR: ['style','srcset'], ADD_ATTR: ['target','rel'] })
    .replace(/<img\b[^>]*\bsrc=["']https?:\/\/[^>]*>/gi, '<span class="blocked-image">[远程图片已阻止]</span>')
})

function clickContent(event: MouseEvent) {
  const anchor = (event.target as HTMLElement).closest('a')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.getAttribute('href')
  if (href) void window.unifiedMail.shell.openExternal(href).catch(() => undefined)
}
</script>

<template>
  <section class="detail-column">
    <div v-if="!selected" class="detail-empty-state">
      <div class="empty-envelope"><span></span></div>
      <h2>选择一封邮件</h2>
      <p>邮件内容将在这里安全显示，打开详情不会自动标记已读。</p>
      <div class="empty-hint"><span>提示</span> 使用左侧列表快速切换邮件</div>
    </div>
    <NSpin v-else :show="loading" class="detail-spin">
      <template v-if="detail">
        <header class="detail-header">
          <NButton class="detail-back" quaternary size="small" aria-label="返回邮件列表" @click="emit('back')">← 返回</NButton>
          <div class="detail-title"><span class="detail-kicker">邮件详情</span><h2>{{ detail.subject }}</h2></div>
          <NButton type="primary" secondary :loading="selected.operationPending" @click="emit('markRead')">标记已读</NButton>
        </header>
        <dl class="mail-addresses">
          <div><dt>发件人</dt><dd>{{ detail.senderName }} &lt;{{ detail.senderAddress }}&gt;</dd></div>
          <div><dt>收件人</dt><dd>{{ detail.recipients.join('、') || '未提供' }}</dd></div>
          <div><dt>时间</dt><dd>{{ formatTime(detail.receivedAt) }}</dd></div>
          <div><dt>账户</dt><dd><NTag size="small">{{ detail.accountName }}</NTag></dd></div>
        </dl>
        <div class="detail-body" @click="clickContent">
          <div v-if="safeHtml" class="html-mail" v-html="safeHtml"></div>
          <pre v-else>{{ detail.textBody || '邮件没有可显示的正文。' }}</pre>
        </div>
        <section v-if="detail.attachments.length" class="attachments">
          <h3>附件（{{ detail.attachments.length }}）</h3>
          <button v-for="item in detail.attachments" :key="item.id" @click="emit('download', item.id)"><span>{{ item.filename }}</span><small>{{ fileSize(item.size) }} · 点击保存</small></button>
        </section>
      </template>
    </NSpin>
  </section>
</template>
