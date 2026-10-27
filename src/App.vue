<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const currentUnread = computed(() => active.value === 'all' ? store.unreadTotal : store.accounts.find((item) => item.id === active.value)?.unreadCount ?? 0)
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

watch(tutorialVisible, (active) => { void window.unifiedMail.appearance.setTourOverlay(active).catch(() => undefined) })

function reportFailure(error: unknown) { message.error(errorMessage(error)) }
function loadMailsSafely() { void store.loadMails().catch(reportFailure) }
function loadAccountsSafely() { void store.loadAccounts().catch(reportFailure) }
function refreshSafely() { void store.refresh().catch(reportFailure) }

function navigate(key: string) {
  if (key === 'settings' || key === 'history') { view.value = key; active.value = key; return }
  view.value = 'inbox'; active.value = key; store.setScope(key === 'all' ? undefined : key)
}
function controlWindow(action: 'minimize' | 'maximize' | 'close') { void window.unifiedMail.appearance.controlWindow(action).catch(reportFailure) }
function add() { editingAccount.value = null; accountDialog.value = true }
function edit(account: Account) { editingAccount.value = account; accountDialog.value = true }
async function saved() { try { await store.refresh() } catch (error) { reportFailure(error) } }
async function markRead() { try { await store.markRead(); message.success('已同步标记为已读') } catch (e) { message.error(errorMessage(e)) } }
async function markAllRead() {
  try {
    const result = await store.markAllRead()
    if (!result) return
    const content = `已将 ${result.marked} 封邮件标记为已读${result.failed ? `，${result.failed} 个账户处理失败` : ''}`
    if (result.failed) message.warning(content)
    else message.success(content)
  } catch (e) { message.error(errorMessage(e)) }
}
async function syncAll() {
  try {
    const summary = await store.syncAll()
    if (!summary) return
    const content = `新增 ${summary.added} 封，更新 ${summary.updated} 封；${summary.succeeded} 个账户成功${summary.failed ? `，${summary.failed} 个失败` : ''}${summary.remaining ? `，另有 ${summary.remaining} 封将在后续同步` : ''}`
    if (summary.status === 'success') message.success(content)
    else if (summary.status === 'partial') message.warning(content)
    else message.error(content)
  } catch (e) { message.error(errorMessage(e)) }
}
async function download(id: string) { if (!store.detail) return; try { const path = await window.unifiedMail.mails.downloadAttachment(store.detail.id, id); if (path) message.success('附件已保存') } catch (e) { message.error(errorMessage(e)) } }
async function closeTutorial() { tutorialVisible.value = false; try { await window.unifiedMail.settings.update({ tutorialCompleted: true }) } catch { /* 下次仍可在设置中重新打开 */ } }
async function startTutorial() { view.value = 'inbox'; active.value = 'all'; store.setScope(undefined); await nextTick(); tutorialVisible.value = true }

onMounted(async () => {
  try {
    const settings = await window.unifiedMail.settings.get()
    store.pageSize = settings.pageSize
    await store.loadAccounts()
    const defaultAccount = store.accounts.find((account) => account.id === settings.defaultAccountScope && account.isEnabled)
    if (defaultAccount) { active.value = defaultAccount.id; store.setScope(defaultAccount.id, undefined, false) }
    else { active.value = 'all'; store.setScope(undefined, undefined, false) }
    await store.loadMails()
    if (!settings.tutorialCompleted) window.setTimeout(() => { tutorialVisible.value = true }, 450)
  } catch (error) { reportFailure(error) }
  disposers.push(window.unifiedMail.events.on('accounts:changed', loadAccountsSafely))
  disposers.push(window.unifiedMail.events.on('mails:changed', loadMailsSafely))
  disposers.push(window.unifiedMail.events.on('sync:state', ({ running, summary }) => { store.syncing = running; if (summary) store.lastSync = summary }))
})
onBeforeUnmount(() => {
  void window.unifiedMail.appearance.setTourOverlay(false).catch(() => undefined)
  disposers.forEach((dispose) => dispose())
})
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides">
    <NDialogProvider><NMessageProvider>
      <div class="app-shell" :class="{ 'modal-active': tutorialVisible }">
        <header class="window-titlebar">
          <div class="titlebar-brand"><span class="titlebar-logo"></span><strong>UnifiedMail</strong><span>多邮箱统一管理</span></div>
          <div class="titlebar-status"><i></i>数据仅保存在本机</div>
          <div class="window-controls" aria-label="窗口控制">
            <button type="button" aria-label="最小化" @click="controlWindow('minimize')"><span class="window-minimize"></span></button>
            <button type="button" aria-label="最大化或还原" @click="controlWindow('maximize')"><span class="window-maximize"></span></button>
            <button type="button" class="window-close-button" aria-label="关闭" @click="controlWindow('close')"><span class="window-close"></span></button>
          </div>
        </header>
        <SidebarNav :accounts="store.accounts" :total="store.unreadTotal" :active="active" :view="view" @navigate="navigate" @add="add" />
        <div v-if="view === 'inbox'" class="inbox-layout" :class="{ 'show-detail': store.selected }">
          <MailList :mails="store.mails" :total="store.total" :unread-count="currentUnread" :selected-id="store.selected?.id" :loading="store.loading" :syncing="store.syncing" :marking-all="store.markingAll" :title="title" :page="store.page" :page-size="store.pageSize" :search="store.search" :sort="store.sort"
            @select="store.choose" @sync="syncAll" @mark-all-read="markAllRead"
            @update:search="value => { store.search = value; store.page = 1; loadMailsSafely() }"
            @update:sort="value => { store.sort = value; loadMailsSafely() }"
            @update:page="value => { store.page = value; loadMailsSafely() }" />
          <MailDetail data-tour="detail-panel" :selected="store.selected" :detail="store.detail" :loading="store.detailLoading" @back="store.closeDetail" @mark-read="markRead" @download="download" />
        </div>
        <SettingsPage v-else-if="view === 'settings'" :accounts="store.accounts" @add="add" @edit="edit" @changed="refreshSafely" @tutorial="startTutorial" />
        <SyncHistory v-else />
        <AccountDialog v-model:show="accountDialog" :account="editingAccount" @saved="saved" />
        <OnboardingTour :show="tutorialVisible" @skip="closeTutorial" @finish="closeTutorial" />
      </div>
    </NMessageProvider></NDialogProvider>
  </NConfigProvider>
</template>
