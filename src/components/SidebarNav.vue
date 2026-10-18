<script setup lang="ts">
import { NBadge, NButton, NScrollbar, NTag } from 'naive-ui'
import type { Account } from '../../shared/types'
import { PROVIDERS } from '../../shared/providers'
import { formatTime } from '../utils'

defineProps<{ accounts: Account[]; total: number; active: string; view: string }>()
const emit = defineEmits<{ navigate: [key: string]; add: [] }>()

function statusType(account: Account): 'success' | 'error' | 'warning' | 'default' {
  if (account.connectionStatus === 'success' || account.connectionStatus === 'connected') return 'success'
  if (account.connectionStatus === 'auth_required') return 'warning'
  if (account.connectionStatus === 'failed') return 'error'
  return 'default'
}
</script>

<template>
  <aside class="sidebar">
    <header class="sidebar-heading"><strong>邮箱</strong><NButton data-tour="add-account" size="tiny" secondary @click="emit('add')">＋ 添加账户</NButton></header>
    <NScrollbar class="nav-scroll">
      <nav>
        <button data-tour="inbox-nav" class="nav-item" :class="{ active: view === 'inbox' && active === 'all' }" @click="emit('navigate', 'all')">
          <span class="nav-label"><span class="nav-icon inbox-icon"></span>统一收件箱</span><NBadge :value="total" :max="999" />
        </button>
        <div class="nav-heading"><span>已绑定账户</span></div>
        <div v-if="!accounts.length" class="empty-account">尚未添加邮箱</div>
        <button v-for="account in accounts" :key="account.id" class="nav-item account-item" :class="{ active: view === 'inbox' && active === account.id }" @click="emit('navigate', account.id)">
          <span class="account-avatar">{{ account.displayName.slice(0, 1).toUpperCase() }}</span>
          <span class="account-copy"><strong>{{ account.displayName }}</strong><small>{{ account.email }}</small></span>
          <span class="account-side"><NBadge :value="account.unreadCount" :max="999" /><NTag :type="statusType(account)" size="tiny" :bordered="false">{{ account.isEnabled ? (account.connectionStatus === 'syncing' ? '同步中' : PROVIDERS[account.provider].label.replace('邮箱', '')) : '停用' }}</NTag></span>
        </button>
      </nav>
    </NScrollbar>
    <footer class="sidebar-footer">
      <button class="nav-item" :class="{ active: view === 'history' }" @click="emit('navigate', 'history')"><span class="nav-label"><span class="nav-icon history-icon"></span>同步记录</span></button>
      <button data-tour="settings-nav" class="nav-item" :class="{ active: view === 'settings' }" @click="emit('navigate', 'settings')"><span class="nav-label"><span class="nav-icon settings-icon"></span>设置</span></button>
      <span v-if="accounts.length">最近同步：{{ formatTime(accounts.map(a => a.lastSyncAt).filter(Boolean).sort().at(-1) ?? null) }}</span>
    </footer>
  </aside>
</template>
