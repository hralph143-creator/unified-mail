<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import { NButton, NDataTable, NTag } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { SyncRun } from '../../shared/types'
import { formatTime } from '../utils'

const rows = ref<SyncRun[]>([])
const loading = ref(false)
const columns: DataTableColumns<SyncRun> = [
  { title: '开始时间', key: 'startedAt', width: 150, render: row => formatTime(row.startedAt) },
  { title: '邮箱账户', key: 'accountName', render: row => row.accountName || '全部账户' },
  { title: '触发方式', key: 'trigger', width: 110, render: row => ({ startup:'启动同步',scheduled:'定时同步',manual:'手动同步',account:'单账户同步' }[row.trigger]) },
  { title: '结果', key: 'status', width: 100, render: row => h(NTag, { size: 'small', type: row.status === 'success' ? 'success' : row.status === 'running' ? 'info' : 'error' }, { default: () => row.status === 'success' ? '成功' : row.status === 'running' ? '进行中' : '失败' }) },
  { title: '新增', key: 'addedCount', width: 70 }, { title: '更新', key: 'updatedCount', width: 70 },
  { title: '说明', key: 'errorMessage', ellipsis: { tooltip: true }, render: row => row.errorMessage || '同步完成' }
]
async function load() { loading.value = true; try { rows.value = await window.unifiedMail.sync.history(100) } finally { loading.value = false } }
onMounted(load)
</script>

<template><main class="page-view history-page"><header class="page-header"><div><h1>同步记录</h1><span>最近 100 次账户同步结果</span></div><NButton :loading="loading" @click="load">刷新</NButton></header><NDataTable :columns="columns" :data="rows" :loading="loading" :bordered="false" /></main></template>
