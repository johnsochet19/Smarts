declare const chrome: any

export type ChatContext = { chat: string; messages: string[] }
export type SourceId = 'perplexity' | 'claude' | 'whatsapp' | 'board'
export type BoardContext = { title: string; text: string }
export type BoardStatus = 'ready' | 'no-tab' | 'locked' | 'error'

export const BOARD_URL = 'https://john-projects.sites.tab.bot/'
export const BOARD_MATCH = 'https://john-projects.sites.tab.bot/*'
export const BOARD_WHATSAPP = '12512765320'
export type Engine = 'perplexity' | 'claude'
export type Rule = { id: SourceId; enabled: boolean; keywords: string[] }
export type Pick = { id: SourceId; reason: string }

export type EngineLink = { tabId?: number; url?: string }
export type Turn = { id: string; question: string; used: SourceId[]; at: number; chatName?: string; project?: string; links: Partial<Record<Engine, EngineLink>> }
export type Conversation = {
  id: string
  title: string
  turns: Turn[]
  updatedAt: number
}

export const ORDER: SourceId[] = ['perplexity', 'claude', 'whatsapp', 'board']
export const ENGINES: Engine[] = ['perplexity', 'claude']

export const SOURCES: Record<SourceId, { label: string; kind: 'answer' | 'context'; strength: string }> = {
  perplexity: { label: 'Perplexity', kind: 'answer', strength: 'Live web facts, news, prices, citations' },
  claude: { label: 'Claude', kind: 'answer', strength: 'Reasoning, writing, planning, replies' },
  whatsapp: { label: 'WhatsApp', kind: 'context', strength: 'The chat open in WhatsApp Web' },
  board: { label: 'My Projects', kind: 'context', strength: 'Your project board at john-projects.sites.tab.bot' },
}

export const DEFAULT_RULES: Rule[] = [
  { id: 'perplexity', enabled: true, keywords: ['latest', 'news', 'today', 'current', 'price', 'cost', 'best', 'review', 'compare', 'source', 'fact', 'stats', 'who is', 'where', 'when', 'weather', 'near me'] },
  { id: 'claude', enabled: true, keywords: ['why', 'explain', 'write', 'draft', 'reply', 'rewrite', 'plan', 'code', 'analyze', 'think', 'summarize', 'decide', 'strategy', 'email', 'help me', 'idea'] },
  { id: 'whatsapp', enabled: true, keywords: ['whatsapp', 'chat', 'message', 'reply', 'group', 'said', 'conversation', 'texted', 'they want', 'respond'] },
  { id: 'board', enabled: true, keywords: ['project', 'projects', 'board', 'status', 'deadline', 'task', 'client', 'progress', 'overdue', 'milestone', 'this week'] },
]

const PREVIEW_BOARD: BoardContext = {
  title: 'My Projects',
  text: [
    'Bakery website redesign: In progress, 70%. Next: menu page photos. Due Nov 8.',
    'Weekend Trip booking: Waiting on group decision (Friday vs Saturday cabin).',
    'Client invoice #142 (Ruiz Studio): Sent Oct 28, unpaid.',
    'Triad extension: Testing in Chrome. Next: WhatsApp connection.',
  ].join('\n'),
}

export async function readBoard(): Promise<{ board: BoardContext | null; status: BoardStatus; preview: boolean }> {
  if (!isExtension()) return { board: PREVIEW_BOARD, status: 'ready', preview: true }
  try {
    const tabs = await chrome.tabs.query({ url: BOARD_MATCH })
    const tab = tabs?.[0]
    if (!tab?.id) return { board: null, status: 'no-tab', preview: false }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim()
        return { title: document.title || 'My Projects', text: text.slice(0, 4000) }
      },
    })
    const data = res?.result as BoardContext | null
    if (!data?.text) return { board: null, status: 'error', preview: false }
    if (/6-digit code|Log in with your password/i.test(data.text) && data.text.length < 600) return { board: null, status: 'locked', preview: false }
    return { board: data, status: 'ready', preview: false }
  } catch {
    return { board: null, status: 'error', preview: false }
  }
}

/** Pulls project names from the board text ("Name: details" lines). */
export function parseProjects(text: string | undefined | null): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const idx = line.indexOf(':')
    if (idx < 3 || idx > 60) continue
    const name = line.slice(0, idx).replace(/^[-•*\d.\s]+/, '').trim()
    if (name.length >= 3 && !/^\[|^https?$/i.test(name)) out.add(name)
    if (out.size >= 40) break
  }
  return [...out]
}

export async function openBoard() {
  if (!isExtension()) {
    window.open(BOARD_URL, '_blank', 'noopener')
    return
  }
  const tabs = await chrome.tabs.query({ url: BOARD_MATCH })
  if (tabs?.[0]?.id) await chrome.tabs.update(tabs[0].id, { active: true })
  else await chrome.tabs.create({ url: BOARD_URL })
}

/** Pre-fills the question in your WhatsApp Web tab, addressed to the board's WhatsApp assistant. You press send. */
export async function askBoardOnWhatsApp(q: string) {
  const url = `https://web.whatsapp.com/send?phone=${BOARD_WHATSAPP}&text=${encodeURIComponent(q)}`
  if (!isExtension()) {
    window.open(url, '_blank', 'noopener')
    return
  }
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  if (tabs?.[0]?.id) await chrome.tabs.update(tabs[0].id, { url, active: true })
  else await chrome.tabs.create({ url })
}

const PREVIEW_CHAT: ChatContext = {
  chat: 'Weekend Trip 🏕️',
  messages: [
    '[09:12, 03/11/2026] Sara: Are we still doing Friday or pushing to Saturday?',
    '[09:14, 03/11/2026] Malik: Saturday works better for me, I finish late Friday',
    '[09:20, 03/11/2026] Sara: Ok but the cabin is cheaper Friday night, like 40 less',
    '[09:21, 03/11/2026] Jonas: I can drive if we leave before 10am',
    '[09:30, 03/11/2026] Sara: Can someone decide pls 😅',
  ],
}

export const isExtension = () =>
  typeof chrome !== 'undefined' && !!chrome?.tabs?.query && chrome?.runtime?.id !== 'shipper-preview-mode'

export type ChatStatus = 'ready' | 'no-tab' | 'no-chat' | 'error'

export async function readWhatsApp(): Promise<{ chat: ChatContext | null; status: ChatStatus; preview: boolean }> {
  if (!isExtension()) return { chat: PREVIEW_CHAT, status: 'ready', preview: true }
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
    const tab = tabs?.[0]
    if (!tab?.id) return { chat: null, status: 'no-tab', preview: false }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const main = document.querySelector('#main')
        if (!main) return null
        const name = (main.querySelector('header span[dir="auto"]') as HTMLElement | null)?.innerText ?? 'Current chat'
        const msgs = Array.from(main.querySelectorAll('[data-pre-plain-text]'))
          .slice(-40)
          .map((el) => {
            const meta = el.getAttribute('data-pre-plain-text') ?? ''
            const body = ((el.querySelector('span.selectable-text') as HTMLElement | null)?.innerText ?? (el as HTMLElement).innerText ?? '').trim()
            return `${meta}${body}`.trim()
          })
          .filter(Boolean)
        return { chat: name, messages: msgs }
      },
    })
    const data = res?.result as ChatContext | null
    if (!data) return { chat: null, status: 'no-chat', preview: false }
    return { chat: data, status: data.messages.length ? 'ready' : 'no-chat', preview: false }
  } catch {
    return { chat: null, status: 'error', preview: false }
  }
}

export async function openWhatsApp() {
  if (!isExtension()) {
    window.open('https://web.whatsapp.com', '_blank', 'noopener')
    return
  }
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  if (tabs?.[0]?.id) await chrome.tabs.update(tabs[0].id, { active: true })
  else await chrome.tabs.create({ url: 'https://web.whatsapp.com' })
}

export function route(
  q: string,
  rules: Rule[],
  avail: { whatsapp: boolean; board: boolean },
  overrides: Partial<Record<SourceId, boolean>>,
  linkedProject?: string,
): { picks: Pick[]; skipped: Pick[] } {
  const text = q.toLowerCase()
  const rule = (id: SourceId) => rules.find((r) => r.id === id)
  const hit = (id: SourceId) => {
    const r = rule(id)
    if (!r?.enabled) return null
    return r.keywords.find((k) => k.trim() && text.includes(k.trim().toLowerCase())) ?? null
  }
  const chosen = new Map<SourceId, string>()
  const skipped: Pick[] = []

  const w = hit('whatsapp')
  if (w) chosen.set('whatsapp', `you mentioned "${w}"`)
  const b = hit('board')
  if (b) chosen.set('board', `about your projects ("${b}")`)
  const p = hit('perplexity')
  if (p) chosen.set('perplexity', `needs fresh facts ("${p}")`)
  const c = hit('claude')
  if (c) chosen.set('claude', `needs thinking ("${c}")`)

  if (linkedProject) {
    if (chosen.has('whatsapp') && !chosen.has('board') && rule('board')?.enabled) chosen.set('board', `linked to "${linkedProject}"`)
    if (chosen.has('board') && !chosen.has('whatsapp') && rule('whatsapp')?.enabled) chosen.set('whatsapp', `chat linked to "${linkedProject}"`)
    if (!chosen.has('whatsapp') && text.includes(linkedProject.toLowerCase())) {
      chosen.set('whatsapp', `you named "${linkedProject}"`)
      if (rule('board')?.enabled) chosen.set('board', `you named "${linkedProject}"`)
    }
  }

  if (chosen.has('whatsapp') && !chosen.has('claude') && rule('claude')?.enabled) chosen.set('claude', 'reads your chat privately')
  if (chosen.has('board') && !chosen.has('claude') && rule('claude')?.enabled) chosen.set('claude', 'reads your board privately')

  if (!chosen.has('perplexity') && !chosen.has('claude') && text.trim()) {
    const factual = /^(what|who|when|where|which|how much|how many|is|are|did|does)\b/.test(text.trim())
    let pick: SourceId = chosen.size > 0 ? 'claude' : factual ? 'perplexity' : 'claude'
    if (!rule(pick)?.enabled) pick = pick === 'claude' ? 'perplexity' : 'claude'
    if (rule(pick)?.enabled)
      chosen.set(pick, chosen.size > 0 ? 'best at reasoning over your chat' : factual ? 'quick factual lookup' : 'best general answer')
  }

  for (const [id, on] of Object.entries(overrides) as [SourceId, boolean][]) {
    if (on) chosen.set(id, 'added by you')
    else chosen.delete(id)
  }

  if (chosen.has('whatsapp') && !avail.whatsapp) {
    skipped.push({ id: 'whatsapp', reason: 'open a chat in WhatsApp Web first' })
    chosen.delete('whatsapp')
  }
  if (chosen.has('board') && !avail.board) {
    skipped.push({ id: 'board', reason: 'open and unlock your project board first' })
    chosen.delete('board')
  }

  return { picks: ORDER.filter((id) => chosen.has(id)).map((id) => ({ id, reason: chosen.get(id)! })), skipped }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

export function claudePrompt(q: string, chat: ChatContext | null, withPerplexity: boolean, earlier: string[] = [], board: BoardContext | null = null, linkedProject?: string) {
  const parts = [
    withPerplexity
      ? 'Perplexity is researching live sources for this same question in another tab. Focus on reasoning, trade-offs and a clear recommendation, and flag anything that needs fresh verification.'
      : 'Give a clear, well-reasoned, practical answer.',
  ]
  if (earlier.length) parts.push(`We are continuing an earlier conversation. My previous questions were:\n${earlier.map((e) => `- ${e}`).join('\n')}`)
  parts.push(`Question: ${q}`)
  if (chat) parts.push(`My WhatsApp chat "${chat.chat}" (latest messages):\n${clip(chat.messages.join('\n'), 2500)}`)
  if (board) parts.push(`My project board ("${board.title}"):\n${clip(board.text, 2500)}`)
  if (linkedProject && (chat || board))
    parts.push(`Note: ${chat ? `the WhatsApp chat "${chat.chat}"` : 'my WhatsApp chat'} is about my project "${linkedProject}". Connect what was said in the chat to that project's status on the board, and point out anything that should be updated on either side.`)
  return parts.join('\n\n')
}

export function perplexityQuery(q: string, earlier: string[] = []) {
  if (!earlier.length) return q
  return `${q}\n\n(Follow-up to my earlier questions: ${clip(earlier.join(' | '), 600)})`
}

export const claudeUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`
export const perplexityUrl = (query: string) => `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`

/** Opens each URL in a new tab and returns the created tab ids (same order). */
export async function openUrls(urls: string[]): Promise<(number | undefined)[]> {
  if (isExtension() && chrome.tabs?.create) {
    const ids: (number | undefined)[] = []
    for (let i = 0; i < urls.length; i++) {
      const t = await chrome.tabs.create({ url: urls[i], active: i === urls.length - 1 })
      ids.push(t?.id)
    }
    return ids
  }
  urls.forEach((u) => window.open(u, '_blank', 'noopener'))
  return urls.map(() => undefined)
}

/** A real, re-openable chat address (not the one-off "new chat with question" link). */
export const isThreadUrl = (engine: Engine, url?: string) =>
  !!url && (engine === 'claude' ? /claude\.ai\/chat\/[\w-]+/.test(url) : /perplexity\.ai\/search\/[^?/]+/.test(url))

export async function readTabUrl(tabId: number): Promise<string | null> {
  if (!isExtension()) return null
  try {
    const t = await chrome.tabs.get(tabId)
    return t?.url ?? null
  } catch {
    return null
  }
}

/** Focus the chat if its tab is still open, otherwise open the saved address. Returns false if neither exists. */
export async function focusOrOpen(link: EngineLink | undefined): Promise<boolean> {
  if (!link) return false
  if (isExtension() && link.tabId != null) {
    try {
      const t = await chrome.tabs.get(link.tabId)
      if (t?.id) {
        await chrome.tabs.update(t.id, { active: true })
        if (t.windowId != null) await chrome.windows?.update?.(t.windowId, { focused: true })
        return true
      }
    } catch {
      /* tab was closed */
    }
  }
  if (link.url) {
    if (isExtension()) await chrome.tabs.create({ url: link.url })
    else window.open(link.url, '_blank', 'noopener')
    return true
  }
  return false
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function openFullWindow(): boolean {
  if (!isExtension() || !chrome.runtime?.getURL) return false
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html?full=1') })
  window.close()
  return true
}

export function onTabsChanged(cb: () => void): () => void {
  if (!isExtension() || !chrome.tabs?.onUpdated) return () => {}
  const listener = (_id: number, info: { url?: string; status?: string }) => {
    if (info.url || info.status === 'complete') cb()
  }
  chrome.tabs.onUpdated.addListener(listener)
  return () => chrome.tabs.onUpdated.removeListener(listener)
}
