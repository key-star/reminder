import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const svg = readFileSync(fileURLToPath(new URL('../public/favicon.svg', import.meta.url)))

const targets = [
  ['pwa-192.png', 192],
  ['pwa-512.png', 512],
  ['pwa-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
]

for (const [name, size] of targets) {
  const output = fileURLToPath(new URL(`../public/${name}`, import.meta.url))
  await sharp(svg).resize(size, size).png().toFile(output)
  console.log(`generated ${name} (${size}x${size})`)
}
