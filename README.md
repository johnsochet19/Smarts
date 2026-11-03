# Triad — Chrome extension

Ask once. Triad picks the best of Claude, Perplexity, your open WhatsApp Web chat
and your project board (john-projects.sites.tab.bot), opens the right tabs with a
ready-made prompt, and keeps every question as a conversation you can reopen.

Rebuilt from the Shipper export (`unified-intelligence-hub`) as a plain
Vite + React + Tailwind v4 project: no Shipper plugins, no CRXJS, about 40% smaller bundle.

## Build and install

```bash
npm install
npm run build        # -> dist/
```

Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick `dist/`.
`npm run zip` also writes `triad-extension.zip` for the Chrome Web Store.

`npm run dev` serves the UI at localhost with a sample WhatsApp chat and sample
board (no Chrome APIs needed).

## Layout

| Path | What it is |
| --- | --- |
| `src/lib/engines.ts` | Routing rules, prompt building, reading WhatsApp / the board, tab handling |
| `src/App.tsx` | Popup (400×600) and full-window UI, conversations, rules panel |
| `src/hooks/useChromeStorage.ts` | `chrome.storage.local` state (localStorage outside the extension) |
| `public/content-script.js` | WhatsApp Web: linked / out-of-sync / unlinked dot before each chat name |
| `public/manifest.json` | Manifest V3 |
| `scripts/make-icons.mjs` | Regenerates `public/icons/*.png` from the logo (needs Playwright) |

Storage keys: `triad:rules`, `triad:conversations`, `triad:chat-links`,
`triad:projects`, `triad:history` (legacy, migrated on first open) — unchanged
from the original, so an existing install keeps its data when updated in place.
