import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useTheme } from '@/components/theme-provider'
import { useChromeStorage } from '@/hooks/useChromeStorage'
import {
  DEFAULT_RULES,
  ENGINES,
  ORDER,
  SOURCES,
  claudePrompt,
  claudeUrl,
  focusOrOpen,
  isExtension,
  isThreadUrl,
  onTabsChanged,
  openFullWindow,
  openUrls,
  openWhatsApp,
  perplexityQuery,
  perplexityUrl,
  readTabUrl,
  readWhatsApp,
  readBoard,
  openBoard,
  askBoardOnWhatsApp,
  parseProjects,
  route,
  type BoardContext,
  type BoardStatus,
  type ChatContext,
  type ChatStatus,
  type Conversation,
  type Engine,
  type EngineLink,
  type Rule,
  type SourceId,
  type Turn,
} from '@/lib/engines'

const FULL = typeof window !== 'undefined' && (new URLSearchParams(window.location.search).has('full') || !isExtension())
if (typeof document !== 'undefined') document.documentElement.classList.toggle('popup', !FULL)

type Panel = 'chat' | 'rules'

const EXAMPLES = [
  'What should I reply to this WhatsApp chat?',
  "What's the latest news on AI agents?",
  'Which of my projects are behind this week?',
  'Explain the pros and cons of renting vs buying',
]

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" className="text-primary" stroke="currentColor" aria-hidden="true">
        <path d="M3 4c4 0 6 3 9 8" />
        <path d="M21 4c-4 0-6 3-9 8" />
        <path d="M12 3v9" opacity="0.55" />
        <path d="M12 12v9" strokeWidth="2.6" />
      </svg>
      <div className="flex items-end leading-none">
        <span className="text-lg font-black tracking-tighter text-foreground">Tri</span>
        <span className="text-lg font-light tracking-widest text-primary uppercase">ad</span>
      </div>
    </div>
  )
}

function IconButton({ onClick, label, children, active }: { onClick: () => void; label: string; children: ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border transition-all duration-200 ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <IconButton onClick={() => setTheme(dark ? 'light' : 'dark')} label="Toggle theme">
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </IconButton>
  )
}

function StatusDot({ state }: { state: 'on' | 'off' | 'wait' }) {
  const cls = state === 'on' ? 'bg-primary' : state === 'wait' ? 'bg-primary/50 animate-pulse' : 'bg-muted-foreground/50'
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />
}

const timeAgo = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

const latestLink = (c: Conversation, e: Engine): EngineLink | undefined => {
  for (let i = c.turns.length - 1; i >= 0; i--) {
    const l = c.turns[i].links?.[e]
    if (l && (l.url || l.tabId != null)) return l
  }
  return undefined
}

type LegacyItem = { id: string; question: string; used: string[]; at: number }

export default function App() {
  const [panel, setPanel] = useState<Panel>('chat')
  const [showList, setShowList] = useState(false) // narrow screens only
  const [rules, setRules] = useChromeStorage<Rule[]>('triad:rules', DEFAULT_RULES)
  const [convs, setConvsRaw, convsLoading] = useChromeStorage<Conversation[]>('triad:conversations', [])
  const [legacy, setLegacy, legacyLoading] = useChromeStorage<LegacyItem[]>('triad:history', [])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [question, setQuestion] = useState('')
  const [overrides, setOverrides] = useState<Partial<Record<SourceId, boolean>>>({})
  const [chat, setChat] = useState<ChatContext | null>(null)
  const [chatStatus, setChatStatus] = useState<ChatStatus | 'loading'>('loading')
  const [preview, setPreview] = useState(false)
  const [board, setBoard] = useState<BoardContext | null>(null)
  const [boardStatus, setBoardStatus] = useState<BoardStatus | 'loading'>('loading')
  const [boardPreview, setBoardPreview] = useState(false)
  const [chatLinks, setChatLinks] = useChromeStorage<Record<string, string>>('triad:chat-links', {})

  const convsRef = useRef(convs)
  convsRef.current = convs
  const setConvs = useCallback((next: Conversation[]) => { convsRef.current = next; setConvsRaw(next) }, [setConvsRaw])

  // Bring old "Recent" questions over as conversations, once.
  useEffect(() => {
    if (convsLoading || legacyLoading || !legacy.length) return
    const migrated: Conversation[] = legacy.map((h) => ({
      id: h.id,
      title: h.question,
      updatedAt: h.at,
      turns: [{ id: h.id, question: h.question, at: h.at, used: h.used.filter((u): u is SourceId => (ORDER as string[]).includes(u)), links: {} }],
    }))
    setConvs([...convsRef.current, ...migrated].sort((a, b) => b.updatedAt - a.updatedAt))
    setLegacy([])
  }, [convsLoading, legacyLoading, legacy, setConvs, setLegacy])

  const refreshWhatsApp = () => {
    setChatStatus('loading')
    readWhatsApp()
      .then(({ chat, status, preview }) => { setChat(chat); setChatStatus(status); setPreview(preview) })
      .catch(() => setChatStatus('error'))
  }
  const refreshBoard = () => {
    setBoardStatus('loading')
    readBoard()
      .then(({ board, status, preview }) => { setBoard(board); setBoardStatus(status); setBoardPreview(preview) })
      .catch(() => setBoardStatus('error'))
  }
  const refreshAll = () => { refreshWhatsApp(); refreshBoard() }
  useEffect(refreshAll, [])

  // Remember the real chat address once Claude / Perplexity turn the new-question link into a thread.
  const syncLinks = useCallback(async () => {
    const list = convsRef.current
    let changed = false
    const next = await Promise.all(
      list.map(async (c) => ({
        ...c,
        turns: await Promise.all(
          c.turns.map(async (t) => {
            const links = { ...(t.links ?? {}) }
            for (const e of ENGINES) {
              const l = links[e]
              if (l?.tabId == null) continue
              const url = await readTabUrl(l.tabId)
              if (url && isThreadUrl(e, url) && url !== l.url) { links[e] = { ...l, url }; changed = true }
            }
            return { ...t, links }
          }),
        ),
      })),
    )
    if (changed) setConvs(next)
  }, [setConvs])

  useEffect(() => {
    if (convsLoading) return
    void syncLinks()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onTabsChanged(() => { clearTimeout(timer); timer = setTimeout(() => { void syncLinks() }, 800) })
    const onFocus = () => { void syncLinks(); refreshAll() }
    window.addEventListener('focus', onFocus)
    return () => { off(); clearTimeout(timer); window.removeEventListener('focus', onFocus) }
  }, [convsLoading, syncLinks])

  const safeRules = useMemo(() => ORDER.map((id) => rules.find((r) => r.id === id) ?? DEFAULT_RULES.find((r) => r.id === id)!), [rules])
  const avail = { whatsapp: chatStatus === 'ready' && !!chat, board: boardStatus === 'ready' && !!board }
  const projects = useMemo(() => parseProjects(board?.text), [board])
  const linkedProject = chat ? chatLinks[chat.chat] : undefined
  useEffect(() => {
    const c = (globalThis as any).chrome
    if (isExtension() && !boardPreview && projects.length && c?.storage?.local) c.storage.local.set({ 'triad:projects': projects })
  }, [projects, boardPreview])
  const linkProject = (name: string) => {
    if (!chat) return
    const next = { ...chatLinks }
    if (name) next[chat.chat] = name
    else delete next[chat.chat]
    setChatLinks(next)
    toast.success(name ? `"${chat.chat}" linked to ${name}` : 'Link removed')
  }
  const plan = useMemo(() => route(question, safeRules, avail, overrides, linkedProject), [question, safeRules, avail.whatsapp, avail.board, overrides, linkedProject])
  const picked = new Set(plan.picks.map((p) => p.id))
  const toggle = (id: SourceId) => setOverrides((o) => ({ ...o, [id]: !picked.has(id) }))

  const active = convs.find((c) => c.id === activeId) ?? null
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt)
    return q ? sorted.filter((c) => c.title.toLowerCase().includes(q) || c.turns.some((t) => t.question.toLowerCase().includes(q))) : sorted
  }, [convs, search])

  const ask = async () => {
    const text = question.trim()
    if (!text) return toast.error('Type a question first')
    const ids = new Set(plan.picks.map((x) => x.id))
    if (!ids.has('perplexity') && !ids.has('claude')) return toast.error('Turn on Claude or Perplexity to get an answer')
    const earlier = active ? active.turns.slice(-5).map((t) => t.question) : []
    const useChat = ids.has('whatsapp') ? chat : null
    const useBoard = ids.has('board') ? board : null
    const engines = ENGINES.filter((e) => ids.has(e))
    const urls = engines.map((e) => (e === 'perplexity' ? perplexityUrl(perplexityQuery(text, earlier)) : claudeUrl(claudePrompt(text, useChat, ids.has('perplexity'), earlier, useBoard, linkedProject))))
    const tabIds = await openUrls(urls)
    const links: Turn['links'] = {}
    engines.forEach((e, i) => { links[e] = { tabId: tabIds[i] } })
    const turn: Turn = { id: crypto.randomUUID(), question: text, used: [...ids], at: Date.now(), chatName: useChat?.chat, project: (useChat || useBoard) ? linkedProject : undefined, links }

    const list = convsRef.current
    if (active) {
      setConvs(list.map((c) => (c.id === active.id ? { ...c, turns: [...c.turns, turn], updatedAt: turn.at } : c)))
    } else {
      const conv: Conversation = { id: crypto.randomUUID(), title: text.length > 70 ? text.slice(0, 70) + '…' : text, turns: [turn], updatedAt: turn.at }
      setConvs([conv, ...list].slice(0, 200))
      setActiveId(conv.id)
    }
    toast.success(`Asked ${[...ids].map((i) => SOURCES[i].label).join(' + ')}`)
    setOverrides({})
    setQuestion('')
  }

  const reopen = async (link: EngineLink | undefined, e: Engine) => {
    const ok = await focusOrOpen(link)
    if (!ok) toast.error(`That ${SOURCES[e].label} tab was closed before Triad saved its address. Ask a follow-up below to start it again.`)
  }

  const startNew = () => { setActiveId(null); setPanel('chat'); setShowList(false); setQuestion(''); setOverrides({}) }
  const selectConv = (id: string) => { setActiveId(id); setPanel('chat'); setShowList(false); setOverrides({}) }
  const removeConv = (id: string) => {
    setConvs(convsRef.current.filter((c) => c.id !== id))
    if (activeId === id) setActiveId(null)
    toast.success('Conversation deleted')
  }

  const waText =
    chatStatus === 'loading' ? 'Checking…'
    : chatStatus === 'ready' && chat ? `${chat.chat} · ${chat.messages.length} msgs`
    : chatStatus === 'no-tab' ? 'Not open'
    : chatStatus === 'no-chat' ? 'Open a chat'
    : 'Unavailable'
  const waState: 'on' | 'off' | 'wait' = chatStatus === 'loading' ? 'wait' : avail.whatsapp ? 'on' : 'off'
  const boardText =
    boardStatus === 'loading' ? 'Checking…'
    : boardStatus === 'ready' ? 'Connected'
    : boardStatus === 'locked' ? 'Enter your code'
    : boardStatus === 'no-tab' ? 'Not open'
    : 'Unavailable'
  const boardState: 'on' | 'off' | 'wait' = boardStatus === 'loading' ? 'wait' : avail.board ? 'on' : 'off'

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowList(!showList)}
            aria-label="Conversations"
            className={`grid h-9 w-9 place-items-center rounded-md border transition-all duration-200 md:hidden ${showList ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          </button>
          <Logo />
        </div>
        <div className="flex items-center gap-2">
          {!FULL && (
            <button
              onClick={() => { if (!openFullWindow()) toast.error('Full window only works in the installed extension') }}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold text-foreground transition-all duration-200 hover:border-primary hover:text-primary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
              Full window
            </button>
          )}
          <IconButton onClick={() => setPanel(panel === 'rules' ? 'chat' : 'rules')} label={panel === 'rules' ? 'Back' : 'Routing rules'} active={panel === 'rules'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
          </IconButton>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Conversations sidebar */}
        <aside className={`${showList ? 'flex' : 'hidden'} w-full shrink-0 flex-col border-r border-border bg-muted/40 md:flex md:w-72 lg:w-80`}>
          <div className="space-y-2 p-3">
            <button onClick={startNew} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-200 hover:bg-primary/90">
              <span className="text-base leading-none">+</span> New conversation
            </button>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {convsLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center">
                <p className="text-sm font-medium text-foreground">{search ? 'No matches' : 'No conversations yet'}</p>
                <p className="mt-1 text-xs text-muted-foreground">{search ? 'Try a different word.' : 'Every question you ask is saved here so you can jump back in.'}</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {filtered.map((c) => {
                  const on = c.id === activeId
                  const used = [...new Set(c.turns.flatMap((t) => t.used))]
                  return (
                    <li key={c.id} className="group relative">
                      <button
                        onClick={() => selectConv(c.id)}
                        className={`w-full rounded-lg border px-3 py-2.5 pr-8 text-left transition-all duration-200 ${on ? 'border-primary bg-card shadow-sm' : 'border-transparent hover:border-border hover:bg-card'}`}
                      >
                        <p className="truncate text-sm font-medium text-foreground">{c.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {c.turns.length} {c.turns.length === 1 ? 'question' : 'questions'} · {used.map((u) => SOURCES[u].label).join(', ')} · {timeAgo(c.updatedAt)}
                        </p>
                      </button>
                      <button
                        onClick={() => removeConv(c.id)}
                        aria-label="Delete conversation"
                        className="absolute right-1.5 top-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground opacity-0 transition-all duration-200 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Main */}
        <main className={`${showList ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
          {panel === 'rules' ? (
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="mx-auto max-w-2xl"><RulesView rules={safeRules} onChange={setRules} /></div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="mx-auto max-w-3xl space-y-4 animate-in fade-in duration-300">
                  {/* Sources strip */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-card-foreground"><StatusDot state="on" /> Perplexity</span>
                    <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-card-foreground"><StatusDot state="on" /> Claude</span>
                    <span className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-card-foreground">
                      <StatusDot state={waState} /> <span className="truncate">WhatsApp · {waText}</span>
                    </span>
                    {!avail.whatsapp && chatStatus !== 'loading' && (
                      <button onClick={() => { void openWhatsApp() }} className="text-xs font-semibold text-primary hover:underline">Open WhatsApp</button>
                    )}
                    <span className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-card-foreground">
                      <StatusDot state={boardState} /> <span className="truncate">My Projects · {boardText}</span>
                    </span>
                    {!avail.board && boardStatus !== 'loading' && (
                      <button onClick={() => { void openBoard() }} className="text-xs font-semibold text-primary hover:underline">Open board</button>
                    )}
                    {boardStatus === 'locked' && (
                      <button onClick={() => { void askBoardOnWhatsApp('Send me my board code') }} className="text-xs font-semibold text-primary hover:underline">Get code on WhatsApp</button>
                    )}
                    <button onClick={refreshAll} className="text-xs text-muted-foreground hover:text-foreground hover:underline">Refresh</button>
                  </div>
                  {(preview || boardPreview) && <p className="text-[11px] text-muted-foreground">Preview: using a sample WhatsApp chat and sample project board.</p>}

                  {avail.whatsapp && chat && (
                    <div className="rounded-lg border border-border bg-card p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-primary" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
                        <p className="min-w-0 flex-1 text-sm text-card-foreground">
                          <span className="font-semibold">{chat.chat}</span>{' '}
                          <span className="text-muted-foreground">{linkedProject ? 'is linked to' : 'is about which project?'}</span>
                        </p>
                        {projects.length > 0 ? (
                          <select
                            value={linkedProject ?? ''}
                            onChange={(e) => linkProject(e.target.value)}
                            aria-label="Link this chat to a project"
                            className="max-w-[220px] rounded-md border border-input bg-background px-3.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                          >
                            <option value="">Not linked</option>
                            {linkedProject && !projects.includes(linkedProject) && <option value={linkedProject}>{linkedProject}</option>}
                            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">{linkedProject ? <span className="font-semibold text-primary">{linkedProject}</span> : 'Open your board to pick a project'}</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {linkedProject
                          ? `Asking about this chat now also reads ${linkedProject} on your board, and asking about the project also reads this chat.`
                          : 'Link a chat once and Triad will always pair it with that project.'}
                      </p>
                    </div>
                  )}

                  {active ? (
                    <ConversationView conv={active} onReopen={reopen} />
                  ) : (
                    <div className="py-6 text-center md:py-12">
                      <h1 className="text-2xl font-black tracking-tight text-foreground md:text-3xl">Ask once. Get the best answer.</h1>
                      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Triad picks Claude, Perplexity and your WhatsApp chat depending on what you ask. Every question becomes a conversation you can come back to.</p>
                      <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                        {EXAMPLES.map((ex) => (
                          <button key={ex} onClick={() => setQuestion(ex)} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-all duration-200 hover:border-primary/50 hover:text-foreground">
                            {ex}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Composer */}
              <div className="shrink-0 border-t border-border bg-background px-4 py-3">
                <div className="mx-auto max-w-3xl space-y-2">
                  {question.trim() && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Will use</span>
                      {ORDER.map((id) => {
                        const on = picked.has(id)
                        const why = plan.picks.find((p) => p.id === id)?.reason ?? plan.skipped.find((p) => p.id === id)?.reason
                        return (
                          <button
                            key={id}
                            onClick={() => toggle(id)}
                            title={why}
                            aria-pressed={on}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all duration-200 ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
                          >
                            {on ? '✓ ' : '+ '}{SOURCES[id].label}
                          </button>
                        )
                      })}
                      {picked.has('board') && (
                        <button
                          onClick={() => { void askBoardOnWhatsApp(question.trim()); toast.success('Opened in WhatsApp — press send') }}
                          title="Send this question to your board's WhatsApp assistant"
                          className="rounded-full border border-dashed border-primary/60 px-2.5 py-1 text-xs font-medium text-primary transition-all duration-200 hover:bg-primary/10"
                        >
                          Also ask board on WhatsApp
                        </button>
                      )}
                      {plan.skipped.map((p) => (
                        <span key={p.id} className="text-[11px] text-muted-foreground">{SOURCES[p.id].label}: {p.reason}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={question}
                      onChange={(e) => { setQuestion(e.target.value); setOverrides({}) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask() } }}
                      placeholder={active ? 'Ask a follow-up in this conversation…' : 'Ask anything — Triad picks who answers best'}
                      aria-label="Your question"
                      rows={2}
                      autoFocus
                      className="min-h-[52px] flex-1 resize-none rounded-lg border border-input bg-background px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
                    />
                    <button
                      onClick={() => { void ask() }}
                      disabled={!question.trim()}
                      className="h-[52px] shrink-0 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {active ? 'Follow up' : 'Ask'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function ConversationView({ conv, onReopen }: { conv: Conversation; onReopen: (l: EngineLink | undefined, e: Engine) => void }) {
  const engines = ENGINES.filter((e) => conv.turns.some((t) => t.used.includes(e)))
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <h1 className="text-lg font-bold leading-snug text-card-foreground">{conv.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Started {timeAgo(conv.turns[0]?.at ?? conv.updatedAt)} · {conv.turns.length} {conv.turns.length === 1 ? 'question' : 'questions'}</p>
        {engines.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {engines.map((e) => (
              <button
                key={e}
                onClick={() => onReopen(latestLink(conv, e), e)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90"
              >
                Continue in {SOURCES[e].label} →
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">"Continue" jumps to the chat if it's still open, or reopens it from its saved address. A follow-up below sends your earlier questions along as context.</p>
      </div>

      <ol className="space-y-2">
        {conv.turns.map((t, i) => (
          <li key={t.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start gap-3">
              <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm text-card-foreground">{t.question}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t.used.map((u) => (u === 'whatsapp' && t.chatName ? `WhatsApp (${t.chatName})` : SOURCES[u].label)).join(' + ')}{t.project ? ` · ${t.project}` : ''} · {timeAgo(t.at)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ENGINES.filter((e) => t.used.includes(e)).map((e) => {
                    const l = t.links?.[e]
                    const saved = !!l?.url
                    const usable = saved || l?.tabId != null
                    return (
                      <button
                        key={e}
                        onClick={() => onReopen(l, e)}
                        disabled={!usable}
                        title={usable ? undefined : 'No saved address for this one'}
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-all duration-200 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Open {SOURCES[e].label}{saved ? '' : ' tab'}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function RulesView({ rules, onChange }: { rules: Rule[]; onChange: (r: Rule[]) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(rules.map((r) => [r.id, r.keywords.join(', ')])))
  const update = (id: SourceId, patch: Partial<Rule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const save = (id: SourceId) =>
    update(id, { keywords: (drafts[id] ?? '').split(',').map((k) => k.trim()).filter(Boolean) })

  return (
    <div className="space-y-3 animate-in fade-in duration-300">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Your routing rules</h2>
        <p className="text-xs text-muted-foreground">If a question contains one of these words, Triad uses that source. Edit them to fit how you work.</p>
      </div>
      {rules.map((r) => (
        <div key={r.id} className={`rounded-lg border border-border bg-card p-3 transition-all duration-200 ${r.enabled ? '' : 'opacity-60'}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-card-foreground">{SOURCES[r.id].label}</p>
              <p className="text-[11px] text-muted-foreground">{SOURCES[r.id].strength}</p>
            </div>
            <button
              onClick={() => update(r.id, { enabled: !r.enabled })}
              role="switch"
              aria-checked={r.enabled}
              aria-label={`Use ${SOURCES[r.id].label}`}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-all duration-200 ${r.enabled ? 'bg-primary' : 'bg-muted-foreground/40'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all duration-200 ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <textarea
            value={drafts[r.id] ?? ''}
            onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
            onBlur={() => save(r.id)}
            rows={2}
            disabled={!r.enabled}
            placeholder="Comma-separated trigger words"
            aria-label={`${SOURCES[r.id].label} trigger words`}
            className="mt-2 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed"
          />
        </div>
      ))}
      <button
        onClick={() => {
          onChange(DEFAULT_RULES)
          setDrafts(Object.fromEntries(DEFAULT_RULES.map((r) => [r.id, r.keywords.join(', ')])))
          toast.success('Rules reset')
        }}
        className="w-full rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground"
      >
        Reset to defaults
      </button>
      <p className="text-[11px] text-muted-foreground">Privacy: your WhatsApp messages only go to Claude, never to Perplexity's web search.</p>
    </div>
  )
}
