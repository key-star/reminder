import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription,
  type VapidKeys,
} from '@block65/webcrypto-web-push'
import type { Env, StoredSubscription } from './types'

const MAX_PAYLOAD = 3900

function vapid(env: Env): VapidKeys {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    throw new Error('VAPID 未配置')
  }
  return {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  }
}

function subscriptionOf(item: StoredSubscription): PushSubscription {
  return {
    endpoint: item.endpoint,
    expirationTime: null,
    keys: {
      p256dh: item.p256dh,
      auth: item.auth,
    },
  }
}

export async function sendPush(
  env: Env,
  subscription: StoredSubscription,
  message: PushMessage,
): Promise<Response> {
  const body = JSON.stringify(message.data)
  if (body.length > MAX_PAYLOAD) {
    throw new Error('推送内容过长')
  }

  const payload = await buildPushPayload(message, subscriptionOf(subscription), vapid(env))
  return fetch(subscription.endpoint, payload)
}

export async function sendTestPush(env: Env, subscriptions: StoredSubscription[]): Promise<{
  sent: number
  failed: number
}> {
  let sent = 0
  let failed = 0
  for (const item of subscriptions) {
    try {
      const response = await sendPush(env, item, {
        data: {
          title: '提醒测试',
          body: '云端推送已连接，锁屏也能收到。',
          test: true,
        },
        options: { ttl: 300, urgency: 'high' },
      })
      if (response.ok) {
        sent += 1
      } else {
        failed += 1
      }
    } catch {
      failed += 1
    }
  }
  return { sent, failed }
}
