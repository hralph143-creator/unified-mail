<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSwitch, useMessage } from 'naive-ui'
import type { Account, AccountInput, Provider } from '../../shared/types'
import { PROVIDERS, inferProvider } from '../../shared/providers'
import { errorMessage } from '../utils'

const props = defineProps<{ show: boolean; account?: Account | null }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; saved: [] }>()
const message = useMessage()
const busy = ref(false)
const tested = ref(false)
const form = reactive<AccountInput>({ email: '', provider: 'qq', displayName: '', imapHost: PROVIDERS.qq.host, imapPort: 993, imapSecure: true, authorizationCode: '' })

function reset() {
  const account = props.account
  Object.assign(form, account ? { id: account.id, email: account.email, provider: account.provider, displayName: account.displayName, imapHost: account.imapHost, imapPort: account.imapPort, imapSecure: account.imapSecure, authorizationCode: '' } : { id: undefined, email: '', provider: 'qq', displayName: '', imapHost: PROVIDERS.qq.host, imapPort: 993, imapSecure: true, authorizationCode: '' })
  tested.value = false
}
watch(() => props.show, (value) => { if (value) reset() })
watch(() => form.email, (value) => { if (!props.account && value.includes('@')) form.provider = inferProvider(value) })
watch(() => form.provider, (provider: Provider) => { if (provider !== 'custom') Object.assign(form, { imapHost: PROVIDERS[provider].host, imapPort: PROVIDERS[provider].port, imapSecure: true }); tested.value = false })

async function test() {
  busy.value = true
  try { const result = await window.unifiedMail.accounts.test({ ...form }); tested.value = result.ok; if (result.ok) message.success(result.message); else message.error(result.message) } catch (e) { message.error(errorMessage(e)) } finally { busy.value = false }
}
async function save() {
  busy.value = true
  try { await window.unifiedMail.accounts.save({ ...form }); message.success('邮箱账户已保存'); emit('update:show', false); emit('saved') } catch (e) { message.error(errorMessage(e)) } finally { busy.value = false }
}
</script>

<template>
  <NModal :show="show" preset="card" :title="account ? '重新授权或修改账户' : '添加邮箱账户'" style="width: min(560px, calc(100vw - 32px))" :mask-closable="false" @update:show="value => emit('update:show', value)">
    <NForm label-placement="left" label-width="105" @submit.prevent="save">
      <NFormItem label="服务商">
        <NRadioGroup v-model:value="form.provider"><NRadioButton v-for="(item, key) in PROVIDERS" :key="key" :value="key">{{ item.label }}</NRadioButton></NRadioGroup>
      </NFormItem>
      <NFormItem label="邮箱地址"><NInput v-model:value="form.email" autocomplete="username" placeholder="name@example.com" /></NFormItem>
      <NFormItem label="显示名称"><NInput v-model:value="form.displayName" placeholder="可选，默认使用邮箱地址" /></NFormItem>
      <NFormItem label="客户端授权码"><NInput v-model:value="form.authorizationCode" type="password" show-password-on="click" autocomplete="new-password" placeholder="不是邮箱登录密码" /></NFormItem>
      <template v-if="form.provider === 'custom'">
        <NFormItem label="IMAP 服务器"><NInput v-model:value="form.imapHost" /></NFormItem>
        <NFormItem label="端口"><NInputNumber v-model:value="form.imapPort" :min="1" :max="65535" /></NFormItem>
        <NFormItem label="直接 SSL/TLS"><NSwitch v-model:value="form.imapSecure" /></NFormItem>
      </template>
      <NAlert type="info" :bordered="false">请先在邮箱网页设置中开启 IMAP 服务，并使用服务商生成的第三方客户端授权码。应用不会尝试绕过服务商的安全验证。</NAlert>
      <NAlert v-if="form.provider === 'custom' && !form.imapSecure" type="warning" :bordered="false">关闭直接 SSL/TLS 时仍会强制使用 STARTTLS；服务器不支持安全升级则连接失败。</NAlert>
      <div class="dialog-actions"><NButton :loading="busy" @click="test">测试连接</NButton><NButton type="primary" attr-type="submit" :loading="busy" :disabled="!form.email || !form.authorizationCode || !form.imapHost">连接并保存</NButton></div>
    </NForm>
  </NModal>
</template>
