import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Account, MailDetail, MailSummary, Provider, SyncSummary } from '../../shared/types'
import { errorMessage } from '../utils'

export const useMailStore = defineStore('mail', () => {
  const accounts = ref<Account[]>([])
  const mails = ref<MailSummary[]>([])
  const total = ref(0)
  const selected = ref<MailSummary | null>(null)
  const detail = ref<MailDetail | null>(null)
  const selectedAccount = ref<string | undefined>()
  const selectedProvider = ref<Provider | undefined>()
  const search = ref('')
  const sort = ref<'desc' | 'asc'>('desc')
  const page = ref(1)
  const pageSize = ref(50)
  const loading = ref(false)
  const detailLoading = ref(false)
  const syncing = ref(false)
  const markingAll = ref(false)
  const lastSync = ref<SyncSummary | null>(null)
  const error = ref('')
  let mailRequest = 0
  let detailRequest = 0
  const unreadTotal = computed(() => accounts.value.reduce((sum, item) => sum + item.unreadCount, 0))

  async function loadAccounts() { accounts.value = await window.unifiedMail.accounts.list() }
  async function loadMails() {
    const request = ++mailRequest
    loading.value = true
    try {
      const result = await window.unifiedMail.mails.list({ accountId: selectedAccount.value, provider: selectedProvider.value, search: search.value, page: page.value, pageSize: pageSize.value, sort: sort.value })
      if (request !== mailRequest) return
      mails.value = result.items; total.value = result.total
      if (selected.value && !mails.value.some((item) => item.id === selected.value?.id)) { selected.value = null; detail.value = null }
    } finally { if (request === mailRequest) loading.value = false }
  }
  async function refresh() { await Promise.all([loadAccounts(), loadMails()]) }
  async function choose(mail: MailSummary) {
    const request = ++detailRequest
    selected.value = mail; detail.value = null; detailLoading.value = true; error.value = ''
    try {
      const result = await window.unifiedMail.mails.detail(mail.id)
      if (request === detailRequest && selected.value?.id === mail.id) detail.value = result
    } catch (e) {
      if (request === detailRequest) error.value = errorMessage(e)
    } finally { if (request === detailRequest) detailLoading.value = false }
  }
  async function markRead(mail = selected.value) {
    if (!mail || mail.operationPending) return
    mail.operationPending = true; error.value = ''
    try { await window.unifiedMail.mails.markRead(mail.id); await refresh() } catch (e) { mail.operationPending = false; error.value = errorMessage(e); throw e }
  }
  async function markAllRead() {
    if (markingAll.value) return null
    markingAll.value = true; error.value = ''
    try {
      const result = await window.unifiedMail.mails.markAllRead({ accountId: selectedAccount.value, provider: selectedProvider.value })
      await refresh()
      return result
    } catch (e) {
      error.value = errorMessage(e)
      throw e
    } finally { markingAll.value = false }
  }
  async function syncAll(): Promise<SyncSummary | null> {
    if (syncing.value) return null
    syncing.value = true; error.value = ''
    try {
      const summary = await window.unifiedMail.sync.all('manual')
      lastSync.value = summary
      await refresh()
      return summary
    } catch (e) {
      error.value = errorMessage(e)
      throw e
    } finally { syncing.value = false }
  }
  function setScope(accountId?: string, provider?: Provider, load = true) {
    detailRequest++
    selectedAccount.value = accountId; selectedProvider.value = provider; page.value = 1; selected.value = null; detail.value = null; detailLoading.value = false
    if (load) void loadMails().catch((e: unknown) => { error.value = errorMessage(e) })
  }

  function closeDetail() {
    detailRequest++
    selected.value = null
    detail.value = null
    detailLoading.value = false
  }

  return { accounts, mails, total, selected, detail, selectedAccount, selectedProvider, search, sort, page, pageSize, loading, detailLoading, syncing, markingAll, lastSync, error, unreadTotal, loadAccounts, loadMails, refresh, choose, markRead, markAllRead, syncAll, setScope, closeDetail }
})
