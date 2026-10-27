<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NCard, NInputNumber, NPopconfirm, NSelect, NSwitch, useMessage } from 'naive-ui'
import type { Account, AppSettings } from '../../shared/types'
import { formatTime, errorMessage } from '../utils'

const props = defineProps<{ accounts: Account[] }>()
const emit = defineEmits<{ add: []; edit: [account: Account]; changed: []; tutorial: [] }>()
const message = useMessage()
const settings = ref<AppSettings | null>(null)
const dataPath = ref('')
const saving = ref(false)
const intervalOptions = [{ label: '15 分钟', value: 15 }, { label: '30 分钟', value: 30 }, { label: '1 小时', value: 60 }, { label: '3 小时', value: 180 }, { label: '6 小时', value: 360 }, { label: '12 小时', value: 720 }, { label: '24 小时', value: 1440 }]
const scopeOptions = computed(() => [{ label: '统一收件箱', value: 'all' }, ...props.accounts.filter((account) => account.isEnabled).map((account) => ({ label: account.displayName, value: account.id }))])

onMounted(async () => { settings.value = await window.unifiedMail.settings.get(); dataPath.value = await window.unifiedMail.settings.dataPath() })
async function update(patch: Partial<AppSettings>) { saving.value = true; try { settings.value = await window.unifiedMail.settings.update(patch); message.success('设置已保存') } catch (e) { message.error(errorMessage(e)) } finally { saving.value = false } }
async function toggle(account: Account, enabled: boolean) { try { await window.unifiedMail.accounts.setEnabled(account.id, enabled); emit('changed') } catch (e) { message.error(errorMessage(e)) } }
async function remove(account: Account) { try { await window.unifiedMail.accounts.remove(account.id); message.success('账户及本地索引已删除'); emit('changed') } catch (e) { message.error(errorMessage(e)) } }
async function sync(account: Account) { try { await window.unifiedMail.sync.account(account.id); message.success(`${account.displayName} 同步完成`); emit('changed') } catch (e) { message.error(errorMessage(e)) } }
async function clearCache() { try { await window.unifiedMail.settings.clearMailCache(); message.success('正文摘要和附件临时缓存已清理'); emit('changed') } catch (e) { message.error(errorMessage(e)) } }
</script>

<template>
  <main class="page-view settings-page">
    <header class="page-header"><div><h1>设置</h1><span>账户与本机运行设置</span></div><NButton type="primary" @click="emit('add')">添加邮箱</NButton></header>
    <NCard title="邮箱账户" size="small">
      <div v-if="props.accounts.length" class="settings-accounts">
        <div v-for="account in props.accounts" :key="account.id" class="settings-account">
          <div><strong>{{ account.displayName }}</strong><span>{{ account.email }}</span><small>{{ account.lastError || `最近同步：${formatTime(account.lastSyncAt)}` }}</small></div>
          <NSwitch :value="account.isEnabled" @update:value="value => toggle(account, value)" />
          <NButton size="small" :disabled="!account.isEnabled" @click="sync(account)">同步</NButton>
          <NButton size="small" @click="emit('edit', account)">重新授权</NButton>
          <NPopconfirm @positive-click="remove(account)"><template #trigger><NButton size="small" type="error" secondary>删除</NButton></template>删除后将同时移除本地凭据和邮件索引，确定继续？</NPopconfirm>
        </div>
      </div>
      <div v-else class="settings-empty">尚未添加邮箱账户。</div>
    </NCard>
    <NCard v-if="settings" title="同步与后台" size="small">
      <div class="setting-row"><div><strong>自动同步</strong><span>应用启动及持续运行时按间隔同步</span></div><NSwitch :value="settings.autoSyncEnabled" :loading="saving" @update:value="value => update({ autoSyncEnabled: value })" /></div>
      <div class="setting-row"><div><strong>同步间隔</strong><span>默认 6 小时，最短 15 分钟</span></div><NSelect :value="settings.syncIntervalMinutes" :options="intervalOptions" style="width: 150px" @update:value="value => update({ syncIntervalMinutes: value })" /></div>
      <div class="setting-row"><div><strong>开机自动启动</strong><span>登录 Windows 后在后台启动</span></div><NSwitch :value="settings.launchAtLogin" @update:value="value => update({ launchAtLogin: value })" /></div>
      <div class="setting-row"><div><strong>关闭窗口时最小化到托盘</strong><span>托盘运行期间自动同步会继续</span></div><NSwitch :value="settings.minimizeToTray" @update:value="value => update({ minimizeToTray: value })" /></div>
      <div class="setting-row"><div><strong>系统通知</strong><span>同步发现新未读邮件时通知</span></div><NSwitch :value="settings.notificationsEnabled" @update:value="value => update({ notificationsEnabled: value })" /></div>
      <div class="setting-row"><div><strong>每页邮件数量</strong><span>适用于统一收件箱列表</span></div><NInputNumber :value="settings.pageSize" :min="10" :max="100" :step="10" style="width: 150px" @update:value="value => value && update({ pageSize: value })" /></div>
      <div class="setting-row"><div><strong>默认收件箱</strong><span>应用启动后优先显示的邮箱范围</span></div><NSelect :value="settings.defaultAccountScope" :options="scopeOptions" style="width: 180px" @update:value="value => update({ defaultAccountScope: value })" /></div>
    </NCard>
    <NCard title="本地数据" size="small">
      <div class="setting-row"><div><strong>数据存储位置</strong><span class="path-text">{{ dataPath }}</span></div></div>
      <div class="setting-row"><div><strong>清理邮件缓存</strong><span>删除正文摘要和附件临时缓存，不删除账户及邮件身份索引</span></div><NPopconfirm @positive-click="clearCache"><template #trigger><NButton>清理缓存</NButton></template>确定清理本地邮件缓存？</NPopconfirm></div>
    </NCard>
    <NCard title="使用帮助" size="small">
      <div class="setting-row"><div><strong>新手引导</strong><span>重新查看添加账户、收件箱、同步和搜索等功能说明</span></div><NButton @click="emit('tutorial')">重新查看引导</NButton></div>
    </NCard>
    <NCard title="关于" size="small"><div class="about"><strong>多邮箱统一管理与双向同步系统</strong><span>版本 1.0.0</span><p>凭据使用 Windows 当前用户的安全存储机制加密。该保护依赖操作系统账户安全，并不等同于对已登录用户的绝对隔离。</p><p>电脑关机或应用完全退出后不会执行同步。</p></div></NCard>
  </main>
</template>
