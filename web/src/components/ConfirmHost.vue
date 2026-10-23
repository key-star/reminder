<script setup lang="ts">
import { settleConfirm, useConfirmState } from '@/composables/useConfirm'

const state = useConfirmState()
</script>

<template>
  <Transition name="fade">
    <div v-if="state.open" class="modal-backdrop" @click.self="settleConfirm(false)">
      <div class="confirm-card" role="dialog" aria-modal="true">
        <h3 class="confirm-title">{{ state.title }}</h3>
        <p class="confirm-message">{{ state.message }}</p>
        <div class="confirm-actions">
          <button class="btn btn-ghost" type="button" @click="settleConfirm(false)">
            {{ state.cancelText }}
          </button>
          <button
            class="btn"
            :class="state.danger ? 'btn-danger' : 'btn-primary'"
            type="button"
            @click="settleConfirm(true)"
          >
            {{ state.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
