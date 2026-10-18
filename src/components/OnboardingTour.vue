<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton } from 'naive-ui'

interface TourStep { selector?: string; eyebrow: string; title: string; description: string }
interface TargetRectangle { left: number; top: number; right: number; width: number; height: number }

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ finish: []; skip: [] }>()
const current = ref(0)
const targetRect = ref<TargetRectangle | null>(null)
const steps: TourStep[] = [
  { eyebrow: '欢迎', title: '几步了解 UnifiedMail', description: '接下来会依次介绍常用功能。你可以随时跳过，以后也能在“设置”中重新查看。' },
  { selector: '[data-tour="add-account"]', eyebrow: '第 1 步', title: '添加你的邮箱', description: '从这里绑定 QQ、网易、Gmail 或其他支持 IMAP 的邮箱账户。账号凭据只保存在本机。' },
  { selector: '[data-tour="inbox-nav"]', eyebrow: '第 2 步', title: '统一收件箱', description: '所有账户的未读邮件会集中显示在这里，也可以在下方切换到某一个邮箱。' },
  { selector: '[data-tour="sync-mail"]', eyebrow: '第 3 步', title: '立即同步', description: '需要马上检查新邮件时点击这里；平时应用也会按照设置的时间间隔自动同步。' },
  { selector: '[data-tour="search-mail"]', eyebrow: '第 4 步', title: '快速搜索', description: '输入发件人、邮件主题或邮箱地址，就能筛选当前收件箱中的邮件。' },
  { selector: '[data-tour="mail-list"]', eyebrow: '第 5 步', title: '浏览邮件列表', description: '点击任意邮件即可在右侧查看完整内容。邮件会按时间排列，并显示附件和同步状态。' },
  { selector: '[data-tour="detail-panel"]', eyebrow: '第 6 步', title: '安全阅读邮件', description: '邮件正文和附件会在这里显示。远程图片默认受到限制，减少隐私追踪风险。' },
  { selector: '[data-tour="settings-nav"]', eyebrow: '最后一步', title: '按你的习惯设置', description: '在设置中管理账户、同步间隔、开机启动和通知，也可以再次打开这份引导。' },
]

const step = computed<TourStep>(() => steps[current.value]!)
const isLast = computed(() => current.value === steps.length - 1)
const highlight = computed(() => {
  const rect = targetRect.value
  if (!rect) return null
  return { x: rect.left - 7, y: rect.top - 7, width: rect.width + 14, height: rect.height + 14 }
})
const cardStyle = computed(() => {
  const rect = targetRect.value
  if (!rect) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  const cardWidth = 350
  const cardHeight = 245
  const gap = 18
  let left = rect.right + gap
  let top = rect.top + rect.height / 2 - cardHeight / 2
  if (left + cardWidth > window.innerWidth - 18) left = rect.left - cardWidth - gap
  if (left < 18) left = Math.min(window.innerWidth - cardWidth - 18, Math.max(18, rect.left))
  top = Math.max(58, Math.min(top, window.innerHeight - cardHeight - 18))
  return { left: `${left}px`, top: `${top}px` }
})

async function locate() {
  await nextTick()
  const selector = step.value.selector
  targetRect.value = selector ? document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null : null
}
function previous() { if (current.value > 0) current.value -= 1 }
function next() { if (isLast.value) emit('finish'); else current.value += 1 }
function onResize() { void locate() }

watch(() => props.show, (show) => { if (show) { current.value = 0; void locate() } })
watch(current, () => void locate())
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="tour-layer" role="dialog" aria-modal="true" aria-label="新手引导">
      <svg class="tour-mask" width="100%" height="100%">
        <defs><mask id="tour-cutout"><rect width="100%" height="100%" fill="white" /><rect v-if="highlight" :x="highlight.x" :y="highlight.y" :width="highlight.width" :height="highlight.height" rx="10" fill="black" /></mask></defs>
        <rect width="100%" height="100%" fill="rgba(18, 27, 40, .62)" mask="url(#tour-cutout)" />
      </svg>
      <div v-if="highlight" class="tour-focus" :style="{ left: `${highlight.x}px`, top: `${highlight.y}px`, width: `${highlight.width}px`, height: `${highlight.height}px` }"></div>
      <section class="tour-card" :style="cardStyle">
        <div class="tour-card-top"><span>{{ step.eyebrow }}</span><button type="button" @click="emit('skip')">跳过引导</button></div>
        <div class="tour-illustration"><span class="tour-mail-icon"></span></div>
        <h2>{{ step.title }}</h2>
        <p>{{ step.description }}</p>
        <footer>
          <div class="tour-dots"><i v-for="(_, index) in steps" :key="index" :class="{ active: index === current }"></i></div>
          <div class="tour-actions"><NButton v-if="current > 0" size="small" @click="previous">上一步</NButton><NButton type="primary" size="small" @click="next">{{ isLast ? '完成' : '下一步' }}</NButton></div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
