import { reactive } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const state = reactive<{ items: ToastItem[] }>({ items: [] })
let sequence = 0

export function toast(message: string, kind: ToastKind = 'info', duration = 2600): void {
  const id = ++sequence
  state.items.push({ id, message, kind })
  window.setTimeout(() => dismissToast(id), duration)
}

export function dismissToast(id: number): void {
  const index = state.items.findIndex((item) => item.id === id)
  if (index >= 0) state.items.splice(index, 1)
}

export function useToastState(): { items: ToastItem[] } {
  return state
}
