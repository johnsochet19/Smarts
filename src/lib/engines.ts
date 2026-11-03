declare const chrome: any

export type SourceId = 'perplexity' | 'claude' | 'board'
export type Engine = 'perplexity' | 'claude'
export type BoardContext = { title: string; text: string; url: string }
export type BoardStatus = 'ready' | 'locked' | 'no-link' | 'no-access' | 'error'

/** Your project board. Change it in Settings; this is only the starting value. */
export const DEFAULT_BOARD_URL = 'https://john-projects.sites.tab.bot/'

export type Rule = { id: SourceId; enabled: boolean; keywords: string[] }
export type Pick = { id: SourceId; reason: string }
export type EngineLink = { tabId?: number; url?: string }
export type Turn = { id: string; question: string; used: SourceId[]; at: number; links: Partial<Record<Engine, EngineLink>> }
export type Conversation = { id: string; title: string; turns: Turn[]; updatedAt: number }

export const ORDER: SourceId[] = ['perplexity', 'claude', 'board']
export const ENGINES: Engine[] = ['perplexity', 'claude']

export const SOURCES: Record<SourceId, { label: string; strength: string }> = {
  perplexity: { label: 'Perplexity', strength: 'Live web facts, news, prices, citations' },
  claude: { label: 'Claude', strength: 'Reasoning, writing, planning, replies' },
  board: { label: 'My Projects', strength: 'Your project board' },
}

export const DEFAULT_RULES: Rule[] = [
  { id: 'perplexity', enabled: true, keywords: ['latest', 'news', 'today', 'current', 'price', 'cost', 'best', 'review', 'compare', 'source', 'fact', 'stats', 'who is', 'where', 'when', 'weather', 'near me'] },
  { id: 'claude', enabled: true, keywords: ['why', 'explain', 'write', 'draft', 'reply', 'rewrite', 'plan', 'code', 'analyze', 'think', 'summarize', 'decide', 'strategy', 'email', 'help me', 'idea'] },
  { id: 'board', enabled: true, keywords: ['project', 'projects', 'board', 'status', 'deadline', 'task', 'client', 'progress', 'overdue', 'milestone', 'this week', 'behind', 'schedule', 'punch', 'job'] },
]

export const isExtension = () =>
  typeof chrome !== 'undefined' && !!chrome?.tabs?.query && chrome?.runtime?.id !== 'shipper-preview-mode'

/** Cleans up what the person typed into a full https address, or null if it isn't one. */
export function normalizeBoardUrl(input: string): string | null {
  let s = input.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    if (!u.hostname.includes('.')) return null
    return u.href
  } catch {
    return null
  }
}

const originPattern = (url: string) => `${new URL(url).origin}/*`

/** True when Triad may read pages on the board's site. */
export async function hasBoardAccess(url: string): Promise<boolean> {
  if (!isExtension() || !chrome.permissions?.contains) return true
  return chrome.permissions.contains({ origins: [originPattern(url)] })
}

/** Asks Chrome for access to the board's site. Must be called from a click. */
export async function requestBoardAccess(url: string): Promise<boolean> {
  if (!isExtension() || !chrome.permissions?.request) return true
  try {
    return await chrome.permissions.request({ origins: [originPattern(url)] })
  } catch {
    return false
  }
}

const PREVIEW_BOARD: BoardContext = {
  title: 'My Projects',
  url: DEFAULT_BOARD_URL,
  text: [
    'Elm St renovation: In progress, 70%. Next: drywall Thursday. Due Nov 21.',
    'Harbor View lofts: Waiting on owner sign-off for finishes.',
    'Client invoice #142 (Ruiz Studio): Sent Oct 28, unpaid.',
  ].join('\n'),
}

const waitForLoad = (tabId: number, ms = 15000) =>
  new Promise<void>((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve() }
    const listener = (id: number, info: { status?: string }) => { if (id === tabId && info.status === 'complete') done() }
    const timer = setTimeout(done, ms)
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.get(tabId).then((t: any) => { if (t?.status === 'complete') done() }).catch(done)
  })

/**
 * Reads the project board. Uses an open tab of it if there is one; otherwise
 * opens it quietly in the background, reads it, and keeps that tab for next time.
 */
export async function readBoard(url: string | null): Promise<{ board: BoardContext | null; status: BoardStatus; preview: boolean }> {
  if (!isExtension()) return { board: PREVIEW_BOARD, status: 'ready', preview: true }
  if (!url) return { board: null, status: 'no-link', preview: false }
  if (!(await hasBoardAccess(url))) return { board: null, status: 'no-access', preview: false }
  try {
    const tabs = await chrome.tabs.query({ url: originPattern(url) })
    let tab = tabs?.find((t: any) => t.url?.startsWith(url)) ?? tabs?.[0]
    if (!tab?.id) {
      tab = await chrome.tabs.create({ url, active: false, pinned: true })
      await waitForLoad(tab.id)
      await new Promise((r) => setTimeout(r, 1200)) // let the board finish drawing
    }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim()
        return { title: document.title || 'My Projects', text: text.slice(0, 6000), url: location.href }
      },
    })
    const data = res?.result as BoardContext | null
    if (!data?.text) return { board: null, status: 'error', preview: false }
    if (/6-digit code|log in|sign in|password/i.test(data.text) && data.text.length < 800) return { board: null, status: 'locked', preview: false }
    return { board: data, status: 'ready', preview: false }
  } catch {
    return { board: null, status: 'error', preview: false }
  }
}

export async function openBoard(url: string | null) {
  if (!url) return
  if (!isExtension()) {
    window.open(url, '_blank', 'noopener')
    return
  }
  const tabs = await chrome.tabs.query({ url: originPattern(url) })
  if (tabs?.[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true })
    if (tabs[0].windowId != null) await chrome.windows?.update?.(tabs[0].windowId, { focused: true })
  } else await chrome.tabs.create({ url })
}

export function route(
  q: string,
  rules: Rule[],
  avail: { board: boolean },
  overrides: Partial<Record<SourceId, boolean>>,
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

  const b = hit('board')
  if (b) chosen.set('board', `about your projects ("${b}")`)
  const p = hit('perplexity')
  if (p) chosen.set('perplexity', `needs fresh facts ("${p}")`)
  const c = hit('claude')
  if (c) chosen.set('claude', `needs thinking ("${c}")`)

  if (chosen.has('board') && !chosen.has('claude') && rule('claude')?.enabled) chosen.set('claude', 'reads your board privately')

  if (!chosen.has('perplexity') && !chosen.has('claude') && text.trim()) {
    const factual = /^(what|who|when|where|which|how much|how many|is|are|did|does)\b/.test(text.trim())
    let pick: SourceId = factual ? 'perplexity' : 'claude'
    if (!rule(pick)?.enabled) pick = pick === 'claude' ? 'perplexity' : 'claude'
    if (rule(pick)?.enabled) chosen.set(pick, factual ? 'quick factual lookup' : 'best general answer')
  }

  for (const [id, on] of Object.entries(overrides) as [SourceId, boolean][]) {
    if (on) chosen.set(id, 'added by you')
    else chosen.delete(id)
  }

  if (chosen.has('board') && !avail.board) {
    skipped.push({ id: 'board', reason: 'board not connected yet' })
    chosen.delete('board')
  }

  return { picks: ORDER.filter((id) => chosen.has(id)).map((id) => ({ id, reason: chosen.get(id)! })), skipped }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

export function claudePrompt(q: string, withPerplexity: boolean, earlier: string[] = [], board: BoardContext | null = null) {
  const parts = [
    withPerplexity
      ? 'Perplexity is researching live sources for this same question in another tab. Focus on reasoning, trade-offs and a clear recommendation, and flag anything that needs fresh verification.'
      : 'Give a clear, well-reasoned, practical answer.',
  ]
  if (earlier.length) parts.push(`We are continuing an earlier conversation. My previous questions were:\n${earlier.map((e) => `- ${e}`).join('\n')}`)
  parts.push(`Question: ${q}`)
  if (board) parts.push(`My project board ("${board.title}", ${board.url}):\n${clip(board.text, 3500)}`)
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
