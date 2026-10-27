import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
})

const publicJwk = publicKey.export({ format: 'jwk' })
const privateJwk = privateKey.export({ format: 'jwk' })

const uncompressed = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(publicJwk.x, 'base64url'),
  Buffer.from(publicJwk.y, 'base64url'),
])

console.log(`VAPID_PUBLIC_KEY=${uncompressed.toString('base64url')}`)
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`)
console.log('VAPID_SUBJECT=mailto:you@example.com')
