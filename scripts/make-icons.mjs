// Renders public/icons/icon-{16,32,48,128}.png from the Triad logo mark.
// Uses the Playwright + Chromium that ship with the dev environment.
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Local install first; otherwise a global one (CommonJS require honours NODE_PATH).
const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'))

const out = fileURLToPath(new URL('../public/icons/', import.meta.url))
const svg = (s) => `<html><body style="margin:0;background:transparent">
<div style="width:${s}px;height:${s}px;border-radius:${Math.round(s * 0.22)}px;background:#3346C8;display:grid;place-items:center">
<svg width="${Math.round(s * 0.74)}" height="${Math.round(s * 0.74)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="${s < 32 ? 2.6 : 2.2}" stroke-linecap="round">
<path d="M3 4c4 0 6 3 9 8"/><path d="M21 4c-4 0-6 3-9 8"/><path d="M12 3v9" opacity="0.6"/><path d="M12 12v9" stroke-width="${s < 32 ? 3.2 : 2.8}"/></svg></div></body></html>`

const browser = await chromium.launch()
for (const s of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 })
  await page.setContent(svg(s))
  await page.screenshot({ path: `${out}icon-${s}.png`, omitBackground: true })
  await page.close()
}
await browser.close()
console.log('icons written')
