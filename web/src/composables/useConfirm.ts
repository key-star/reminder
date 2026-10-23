import { reactive } from 'vue'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState {
  open: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
  resolve: ((value: boolean) => void) | null
}

const state = reactive<ConfirmState>({
  open: false,
  title: '请确认',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  resolve: null,
})

export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  if (state.open && state.resolve) {
    state.resolve(false)
  }
  const normalized = typeof options === 'string' ? { message: options } : options
  state.title = normalized.title ?? '请确认'
  state.message = normalized.message
  state.confirmText = normalized.confirmText ?? '确定'
  state.cancelText = normalized.cancelText ?? '取消'
  state.danger = normalized.danger ?? false
  state.open = true
  return new Promise<boolean>((resolve) => {
    state.resolve = resolve
  })
}

export function settleConfirm(value: boolean): void {
  state.open = false
  const resolve = state.resolve
  state.resolve = null
  resolve?.(value)
}

export function useConfirmState(): ConfirmState {
  return state
}
