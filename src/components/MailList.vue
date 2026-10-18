<script setup lang="ts">
import { NButton, NEmpty, NInput, NPagination, NSelect, NSpin } from 'naive-ui'
import type { MailSummary } from '../../shared/types'
import { formatTime } from '../utils'

defineProps<{ mails: MailSummary[]; total: number; selectedId?: string; loading: boolean; syncing: boolean; title: string; page: number; pageSize: number; search: string; sort: 'asc' | 'desc' }>()
const emit = defineEmits<{ select: [mail: MailSummary]; sync: []; 'update:search': [value: string]; 'update:sort': [value: 'asc' | 'desc']; 'update:page': [value: number] }>()
let searchTimer: ReturnType<typeof setTimeout> | null = null
function searchInput(value: string) { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => emit('update:search', value), 300) }
function senderInitial(mail: MailSummary): string { return (mail.senderName || mail.senderAddress || '邮').trim().slice(0, 1).toUpperCase() }
</script>

<template>
  <section class="mail-column">
    <header class="mail-toolbar">
      <div><div class="toolbar-eyebrow">收件箱</div><h1>{{ title }} <span class="count-pill">{{ total }}</span></h1></div>
      <NButton data-tour="sync-mail" class="sync-button" type="primary" size="small" :loading="syncing" :disabled="syncing" @click="emit('sync')"><span class="sync-glyph">↻</span>立即同步</NButton>
    </header>
    <div class="mail-filters">
      <NInput data-tour="search-mail" class="search-field" :default-value="search" clearable placeholder="搜索发件人、主题或邮箱" @input="searchInput"><template #prefix><span class="search-glyph"></span></template></NInput>
      <NSelect :value="sort" :options="[{label:'时间从新到旧',value:'desc'},{label:'时间从旧到新',value:'asc'}]" style="width: 142px" @update:value="value => emit('update:sort', value)" />
    </div>
    <NSpin data-tour="mail-list" :show="loading" class="mail-list-wrap">
      <div v-if="mails.length" class="mail-list">
        <button v-for="mail in mails" :key="mail.id" class="mail-row" :class="{ selected: selectedId === mail.id }" @click="emit('select', mail)">
          <span class="sender-avatar">{{ senderInitial(mail) }}</span>
          <span class="mail-row-content">
            <span class="mail-row-top"><strong>{{ mail.senderName || mail.senderAddress || '未知发件人' }}</strong><time>{{ formatTime(mail.receivedAt) }}</time></span>
            <span class="mail-subject">{{ mail.subject || '(无主题)' }}</span>
            <span class="mail-preview">{{ mail.preview || '打开邮件查看正文' }}</span>
            <span class="mail-meta"><span class="account-chip">{{ mail.accountName }}</span><span v-if="mail.hasAttachments" class="attachment-chip">附件</span><span v-if="mail.operationPending" class="pending-chip">正在标记已读…</span></span>
          </span>
        </button>
      </div>
      <NEmpty v-else description="暂无未读邮件" class="mail-empty" />
    </NSpin>
    <footer v-if="total > pageSize" class="list-pagination"><NPagination :page="page" :page-size="pageSize" :item-count="total" simple @update:page="value => emit('update:page', value)" /></footer>
  </section>
</template>
