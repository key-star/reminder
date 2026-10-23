<script setup lang="ts">
import { ref, watch } from 'vue'
import { formatDateTime, partsFromTs, tsFromParts } from '@/lib/time'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const date = ref('')
const hour = ref(0)
const minute = ref(0)
const second = ref(0)

function sync(value: number): void {
  const parts = partsFromTs(value)
  date.value = parts.date
  hour.value = parts.hour
  minute.value = parts.minute
  second.value = parts.second
}

sync(props.modelValue)
watch(
  () => props.modelValue,
  (value) => sync(value),
)

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function emitChange(): void {
  const timestamp = tsFromParts({
    date: date.value,
    hour: hour.value,
    minute: minute.value,
    second: second.value,
  })
  if (timestamp !== null && timestamp !== props.modelValue) {
    emit('update:modelValue', timestamp)
  }
}

function normalize(): void {
  hour.value = clampInt(hour.value, 0, 23)
  minute.value = clampInt(minute.value, 0, 59)
  second.value = clampInt(second.value, 0, 59)
  emitChange()
}

function setValue(timestamp: number): void {
  sync(timestamp)
  emit('update:modelValue', timestamp)
}

function inMinutes(minutes: number): void {
  setValue(Date.now() + minutes * 60_000)
}

function at(hours: number, tomorrow: boolean): void {
  const target = new Date()
  if (tomorrow) target.setDate(target.getDate() + 1)
  target.setHours(hours, 0, 0, 0)
  if (!tomorrow && target.getTime() <= Date.now()) {
    target.setDate(target.getDate() + 1)
  }
  setValue(target.getTime())
}
</script>

<template>
  <div class="datetime-fields">
    <input
      v-model="date"
      class="input"
      type="date"
      aria-label="日期"
      @change="emitChange"
    />
    <div class="time-row">
      <label class="time-cell">
        <span>时</span>
        <input
          v-model.number="hour"
          class="input"
          type="number"
          min="0"
          max="23"
          inputmode="numeric"
          @input="emitChange"
          @blur="normalize"
        />
      </label>
      <label class="time-cell">
        <span>分</span>
        <input
          v-model.number="minute"
          class="input"
          type="number"
          min="0"
          max="59"
          inputmode="numeric"
          @input="emitChange"
          @blur="normalize"
        />
      </label>
      <label class="time-cell">
        <span>秒</span>
        <input
          v-model.number="second"
          class="input"
          type="number"
          min="0"
          max="59"
          inputmode="numeric"
          @input="emitChange"
          @blur="normalize"
        />
      </label>
    </div>
    <div class="quick-row">
      <button class="chip-btn" type="button" @click="inMinutes(5)">5 分钟后</button>
      <button class="chip-btn" type="button" @click="inMinutes(30)">30 分钟后</button>
      <button class="chip-btn" type="button" @click="at(20, false)">今晚 20:00</button>
      <button class="chip-btn" type="button" @click="at(9, true)">明天 09:00</button>
    </div>
    <p class="hint">已选择：{{ formatDateTime(props.modelValue) }}</p>
  </div>
</template>
