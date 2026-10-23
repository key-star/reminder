<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DateTimeFields from '@/components/DateTimeFields.vue'
import { confirmDialog } from '@/composables/useConfirm'
import { toast } from '@/composables/useToast'
import { useReminderStore } from '@/stores/reminders'

const store = useReminderStore()
const route = useRoute()
const router = useRouter()

const isEdit = computed(() => route.name === 'edit')
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const title = ref('')
const note = ref('')
const dueAt = ref(Date.now() + 60 * 60 * 1000)
const saving = ref(false)

const current = computed(() =>
  isEdit.value ? store.reminders.find((item) => item.id === id.value) ?? null : null,
)

const statusLabel = computed(() => {
  if (!current.value) return ''
  if (current.value.status === 'done') return '已完成'
  if (current.value.missed_at) return '已错过'
  if (current.value.fired_at) return '已提醒'
  if (current.value.due_at < store.now) return '已过期'
  return '待办'
})

function load(): void {
  if (!isEdit.value) {
    title.value = ''
    note.value = ''
    dueAt.value = Date.now() + 60 * 60 * 1000
    return
  }
  const item = store.reminders.find((reminder) => reminder.id === id.value)
  if (!item) {
    toast('提醒不存在', 'error')
    void router.replace('/')
    return
  }
  title.value = item.title
  note.value = item.note
  dueAt.value = item.due_at
}

watch(() => route.fullPath, load, { immediate: true })

function goBack(): void {
  void router.push('/')
}

async function save(): Promise<void> {
  const titleText = title.value.trim()
  if (!titleText) {
    toast('请填写标题', 'error')
    return
  }
  if (dueAt.value < Date.now() - 1000) {
    const confirmed = await confirmDialog({
      title: '时间已过',
      message: '这个提醒时间已经过去了，仍要保存吗？',
      confirmText: '仍要保存',
    })
    if (!confirmed) return
  }
  saving.value = true
  try {
    if (isEdit.value) {
      await store.save(id.value, {
        title: titleText,
        note: note.value.trim(),
        due_at: dueAt.value,
      })
      toast('已保存', 'success')
    } else {
      await store.create({
        title: titleText,
        note: note.value.trim(),
        due_at: dueAt.value,
      })
      toast('已创建', 'success')
    }
    void router.replace('/')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function removeCurrent(): Promise<void> {
  if (!isEdit.value) return
  const confirmed = await confirmDialog({
    title: '删除提醒',
    message: '删除后无法恢复，确定要删除吗？',
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  try {
    await store.remove(id.value)
    toast('已删除', 'success')
    void router.replace('/')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : '删除失败', 'error')
  }
}
</script>

<template>
  <div class="page form-page">
    <header class="sub-header">
      <button class="icon-btn" type="button" aria-label="返回" @click="goBack">←</button>
      <h1 class="sub-title">{{ isEdit ? '编辑提醒' : '新建提醒' }}</h1>
      <span class="sub-spacer" />
    </header>

    <form class="form" @submit.prevent="save">
      <label class="field">
        <span class="label">标题</span>
        <input
          v-model="title"
          class="input"
          type="text"
          maxlength="120"
          placeholder="例如：给妈妈打电话"
          autocomplete="off"
        />
      </label>

      <label class="field">
        <span class="label">备注</span>
        <textarea
          v-model="note"
          class="input textarea"
          rows="3"
          maxlength="1000"
          placeholder="可选，写点需要记住的细节"
        />
      </label>

      <div class="field">
        <span class="label">提醒时间</span>
        <DateTimeFields v-model="dueAt" />
      </div>

      <p v-if="current" class="hint">
        当前状态：{{ statusLabel }}。修改提醒时间后会重新变为待办。
      </p>

      <button class="btn btn-primary form-submit" type="submit" :disabled="saving">
        {{ saving ? '保存中…' : '保存提醒' }}
      </button>
      <button
        v-if="isEdit"
        class="btn btn-danger form-delete"
        type="button"
        @click="removeCurrent"
      >
        删除提醒
      </button>
    </form>
  </div>
</template>
