// Triad — WhatsApp Web content script.
// Puts a small dot before every chat name in the chat list showing whether that
// chat is linked to a project on your board (green), linked to a project that
// no longer exists (amber), or not linked yet (grey). Hover a dot for details.
// Reads the links written by the popup: chrome.storage.local
//   triad:chat-links  { [chatName]: projectName }
//   triad:projects    string[]  (project names last read from the board)
;(function () {
  const LINKS_KEY = 'triad:chat-links'
  const PROJECTS_KEY = 'triad:projects'
  const STATES = {
    linked: { color: '#16a34a', label: 'Linked' },
    unlinked: { color: '#94a3b8', label: 'Unlinked' },
    sync: { color: '#f59e0b', label: 'Out of sync' },
  }

  let links = {}
  let projects = []

  function explain(state, chat, project) {
    if (state === 'linked')
      return `Linked: "${chat}" is connected to your project "${project}". Triad reads both together when you ask about either.`
    if (state === 'sync')
      return `Out of sync: "${chat}" was linked to "${project}", but that project is no longer on your board (renamed or removed). Open Triad and pick the project again.`
    return `Unlinked: "${chat}" isn't connected to a project yet. Open Triad with this chat open to link it.`
  }

  function stateFor(chat) {
    const project = links[chat]
    if (!project) return { state: 'unlinked' }
    if (projects.length && !projects.some((p) => p.toLowerCase() === project.toLowerCase())) return { state: 'sync', project }
    return { state: 'linked', project }
  }

  let tip = null
  function getTip() {
    if (tip && document.body.contains(tip)) return tip
    tip = document.createElement('div')
    tip.setAttribute('data-triad-tip', '1')
    Object.assign(tip.style, {
      position: 'fixed',
      zIndex: '2147483647',
      maxWidth: '260px',
      padding: '8px 10px',
      borderRadius: '8px',
      background: '#1f2937',
      color: '#fff',
      font: '12px/1.4 system-ui, sans-serif',
      boxShadow: '0 6px 20px rgba(0,0,0,.3)',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity .15s',
    })
    document.body.appendChild(tip)
    return tip
  }
  function showTip(dot) {
    const t = getTip()
    t.textContent = dot.getAttribute('data-triad-text') ?? ''
    const r = dot.getBoundingClientRect()
    t.style.left = `${Math.min(r.left, window.innerWidth - 280)}px`
    t.style.top = `${r.bottom + 6}px`
    t.style.opacity = '1'
  }
  function hideTip() {
    if (tip) tip.style.opacity = '0'
  }

  function makeDot() {
    const d = document.createElement('span')
    d.setAttribute('data-triad-dot', '1')
    d.setAttribute('role', 'img')
    Object.assign(d.style, {
      display: 'inline-block',
      width: '9px',
      height: '9px',
      borderRadius: '50%',
      marginRight: '6px',
      flexShrink: '0',
      verticalAlign: 'middle',
      cursor: 'help',
      boxShadow: '0 0 0 2px rgba(255,255,255,.55)',
    })
    d.addEventListener('mouseenter', () => showTip(d))
    d.addEventListener('mouseleave', hideTip)
    return d
  }

  function paint() {
    const pane = document.querySelector('#pane-side')
    if (!pane) return
    const seen = new Set()
    pane.querySelectorAll('span[title][dir="auto"], span[title]').forEach((el) => {
      const name = el.getAttribute('title')?.trim()
      if (!name || seen.has(el) || !el.closest('[role="listitem"], [role="row"], [data-testid="cell-frame-container"]')) return
      seen.add(el)
      const parent = el.parentElement
      if (!parent) return
      let dot = parent.querySelector(':scope > [data-triad-dot]')
      const { state, project } = stateFor(name)
      const text = explain(state, name, project)
      if (!dot) {
        dot = makeDot()
        parent.style.display = 'flex'
        parent.style.alignItems = 'center'
        parent.style.minWidth = '0'
        el.insertAdjacentElement('beforebegin', dot)
      }
      if (dot.getAttribute('data-state') !== state || dot.getAttribute('data-triad-text') !== text) {
        dot.setAttribute('data-state', state)
        dot.setAttribute('data-triad-text', text)
        dot.setAttribute('aria-label', STATES[state].label)
        dot.style.background = STATES[state].color
      }
    })
  }

  let timer
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(paint, 250)
  }

  function load() {
    chrome.storage.local.get([LINKS_KEY, PROJECTS_KEY], (data) => {
      links = data?.[LINKS_KEY] ?? {}
      projects = data?.[PROJECTS_KEY] ?? []
      schedule()
    })
  }

  load()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (LINKS_KEY in changes || PROJECTS_KEY in changes)) load()
  })
  // Repaint when WhatsApp re-renders the list, ignoring our own dots and tooltip.
  new MutationObserver((muts) => {
    const ours = muts.every((m) => m.target.closest?.('[data-triad-tip]') || m.target.hasAttribute?.('data-triad-dot'))
    if (!ours) schedule()
  }).observe(document.body, { childList: true, subtree: true })
})()
