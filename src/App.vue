<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, createDiscreteApi, zhCN, dateZhCN, type GlobalThemeOverrides } from 'naive-ui'
import SidebarNav from './components/SidebarNav.vue'
import MailList from './components/MailList.vue'
import MailDetail from './components/MailDetail.vue'
import AccountDialog from './components/AccountDialog.vue'
import SettingsPage from './components/SettingsPage.vue'
import SyncHistory from './components/SyncHistory.vue'
import OnboardingTour from './components/OnboardingTour.vue'
import { useMailStore } from './stores/mail'
import type { Account } from '../shared/types'
import { errorMessage } from './utils'

const store = useMailStore()
const view = ref<'inbox' | 'settings' | 'history'>('inbox')
const active = ref('all')
const accountDialog = ref(false)
const editingAccount = ref<Account | null>(null)
const tutorialVisible = ref(false)
const { message } = createDiscreteApi(['message'])
const disposers: Array<() => void> = []
const title = computed(() => active.value === 'all' ? '统一收件箱' : store.accounts.find((item) => item.id === active.value)?.displayName ?? '未读邮件')
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2f6fed',
    primaryColorHover: '#245fd2',
    primaryColorPressed: '#1e51b7',
    primaryColorSuppl: '#2f6fed',
    borderRadius: '6px',
    fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif'
  },
  Button: { borderRadiusSmall: '6px', heightSmall: '32px' },
  Input: { borderRadius: '7px' },
  Select: { peers: { InternalSelection: { borderRadius: '7px' } } },
  Card: { borderRadius: '10px' }
}

function navigate(key: string) {
  if (key === 'settings' || key === 'history') { view.value = key; active.value = key; return }
  view.value = 'inbox'; active.value = key; store.setScope(key === 'all' ? undefined : key)
}
function add() { editingAccount.value = null; accountDialog.value = true }
function edit(account: Account) { editingAccount.value = account; accountDialog.value = true }
async function saved() { await store.refresh() }
async function markRead() { try { await store.markRead(); message.success('已同步标记为已读') } catch (e) { message.error(errorMessage(e)) } }
async function download(id: string) { if (!store.detail) return; try { const path = await window.unifiedMail.mails.downloadAttachment(store.detail.id, id); if (path) message.success('附件已保存') } catch (e) { message.error(errorMessage(e)) } }
async function closeTutorial() { tutorialVisible.value = false; try { await window.unifiedMail.settings.update({ tutorialCompleted: true }) } catch { /* 下次仍可在设置中重新打开 */ } }
async function startTutorial() { view.value = 'inbox'; active.value = 'all'; store.setScope(undefined); await nextTick(); tutorialVisible.value = true }

onMounted(async () => {
  const settings = await window.unifiedMail.settings.get()
  store.pageSize = settings.pageSize
  await store.refresh()
  if (!settings.tutorialCompleted) window.setTimeout(() => { tutorialVisible.value = true }, 450)
  disposers.push(window.unifiedMail.events.on('accounts:changed', () => { void store.loadAccounts() }))
  disposers.push(window.unifiedMail.events.on('mails:changed', () => { void store.loadMails() }))
  disposers.push(window.unifiedMail.events.on('sync:state', ({ running, summary }) => { store.syncing = running; if (summary) store.lastSync = summary }))
})
onBeforeUnmount(() => disposers.forEach((dispose) => dispose()))
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides">
    <NDialogProvider><NMessageProvider>
      <div class="app-shell">
        <header class="window-titlebar">
          <div class="titlebar-brand"><span class="titlebar-logo"></span><strong>UnifiedMail</strong><span>多邮箱统一管理</span></div>
          <div class="titlebar-status"><i></i>数据仅保存在本机</div>
        </header>
        <SidebarNav :accounts="store.accounts" :total="store.unreadTotal" :active="active" :view="view" @navigate="navigate" @add="add" />
        <div v-if="view === 'inbox'" class="inbox-layout">
          <MailList :mails="store.mails" :total="store.total" :selected-id="store.selected?.id" :loading="store.loading" :syncing="store.syncing" :title="title" :page="store.page" :page-size="store.pageSize" :search="store.search" :sort="store.sort"
            @select="store.choose" @sync="store.syncAll"
            @update:search="value => { store.search = value; store.page = 1; void store.loadMails() }"
            @update:sort="value => { store.sort = value; void store.loadMails() }"
            @update:page="value => { store.page = value; void store.loadMails() }" />
          <MailDetail data-tour="detail-panel" :selected="store.selected" :detail="store.detail" :loading="store.detailLoading" @mark-read="markRead" @download="download" />
        </div>
        <SettingsPage v-else-if="view === 'settings'" :accounts="store.accounts" @add="add" @edit="edit" @changed="store.refresh" @tutorial="startTutorial" />
        <SyncHistory v-else />
        <AccountDialog v-model:show="accountDialog" :account="editingAccount" @saved="saved" />
        <OnboardingTour :show="tutorialVisible" @skip="closeTutorial" @finish="closeTutorial" />
      </div>
    </NMessageProvider></NDialogProvider>
  </NConfigProvider>
</template>
