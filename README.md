# Triad — One question, every source

A Chrome extension. Ask once and Triad sends your question to **Claude**, **Perplexity**
or both, and brings your **project board** along when you ask about your projects.

## Install (2 minutes, no tools needed)

1. On this GitHub page click **Code → Download ZIP**, then unzip it.
2. In Chrome open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the **`extension`** folder inside the unzipped folder.
   (Not the top folder — the `extension` folder inside it.)
4. Pin Triad from the puzzle-piece menu so its icon stays in the toolbar.

Updating later: download again, replace the folder, and press the reload arrow on
Triad's card in `chrome://extensions`.

## Using it

- Click the Triad icon and type a question.
- Triad picks who answers: Perplexity for live facts and news, Claude for thinking and
  writing, and your project board when the question is about your projects. You can
  switch any of them on or off under **Will use** before you press Ask.
- **Settings** (sliders icon): paste your project board link. If the board isn't open,
  Triad opens it in a pinned background tab and reads it. If the board asks you to sign
  in, sign in once in that tab.
- Every question is saved as a conversation; **Continue in Claude / Perplexity** jumps
  back to the same chat.

## For developers

```bash
npm install
npm run build   # builds and refreshes the extension/ folder
```

`src/lib/engines.ts` has the routing, prompts and board reading; `src/App.tsx` the UI.
