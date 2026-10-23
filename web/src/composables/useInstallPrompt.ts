import { ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
const justInstalled = ref(false)
let listening = false

export function initInstallPrompt(): void {
  if (listening) return
  listening = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt.value = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    justInstalled.value = true
    deferredPrompt.value = null
  })
}

export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

export function useInstallPrompt() {
  async function promptInstall(): Promise<boolean> {
    const event = deferredPrompt.value
    if (!event) return false
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') {
      justInstalled.value = true
      deferredPrompt.value = null
      return true
    }
    return false
  }

  return {
    deferredPrompt,
    justInstalled,
    isStandalone,
    promptInstall,
  }
}
