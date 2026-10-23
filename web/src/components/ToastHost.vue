<script setup lang="ts">
import { dismissToast, useToastState } from '@/composables/useToast'

const state = useToastState()
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <button
        v-for="item in state.items"
        :key="item.id"
        class="toast"
        :class="`toast-${item.kind}`"
        type="button"
        @click="dismissToast(item.id)"
      >
        {{ item.message }}
      </button>
    </TransitionGroup>
  </div>
</template>
