/* The Notes disguise (src/disguise.ts): ordinary notes that work, kept in this browser. A note whose
   first line is the word set with the disguise opens pawbs when it is closed (and is not kept). Its own
   small chunk, no Vue, nothing of pawbs. */
import type { DecoyContext } from '../disguise'

const CSS = `
.dk-notes{--bg:#faf8f3;--card:#fff;--field:#f1efe8;--line:#d3d1c7;--text:#2c2c2a;--muted:#888780;position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
@media (prefers-color-scheme:dark){.dk-notes{--bg:#161615;--card:#22221f;--field:#2a2a28;--line:#3a3a37;--text:#f1efe8;--muted:#a8a69d}}
.dk-notes h1{margin:0;padding:18px 18px 10px;font-size:26px;font-weight:600}
.dk-notes .search{margin:0 14px 12px;padding:9px 14px;border:0;border-radius:20px;background:var(--field);color:var(--text);font:inherit;outline:none}
.dk-notes .list{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));align-content:start;gap:10px;padding:0 14px calc(90px + env(safe-area-inset-bottom))}
.dk-notes .card{all:unset;box-sizing:border-box;padding:12px;border-radius:14px;background:var(--card);border:1px solid var(--line);cursor:pointer;min-height:84px;overflow:hidden}
.dk-notes .card b{display:block;font-weight:600;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dk-notes .card span{color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
.dk-notes .empty{grid-column:1/-1;color:var(--muted);text-align:center;padding:48px 0}
.dk-notes .fab{all:unset;position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));width:56px;height:56px;border-radius:18px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:30px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.2)}
.dk-notes .bar{display:flex;align-items:center;justify-content:space-between;padding:8px 6px}
.dk-notes .bar button{all:unset;width:44px;height:44px;display:grid;place-items:center;border-radius:50%;cursor:pointer;color:var(--text)}
.dk-notes textarea{flex:1;border:0;outline:none;resize:none;padding:4px 20px 24px;background:transparent;color:var(--text);font:17px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
`
const KEY = 'decoy-notes'
interface Note {
  id: string
  text: string
  at: number
}
const BACK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
const BIN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'

export function mount(root: HTMLElement, ctx: DecoyContext) {
  const style = document.createElement('style')
  style.textContent = CSS
  const el = document.createElement('div')
  el.className = 'dk-notes'
  el.style.setProperty('--accent', ctx.color)
  root.append(style, el)

  const load = (): Note[] => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Note[]
    } catch {
      return []
    }
  }
  let notes = load()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(notes))
    } catch {
      /* full or refused: kept for this visit */
    }
  }
  let query = ''

  function list() {
    el.innerHTML = ''
    const h = document.createElement('h1')
    h.textContent = ctx.name
    const search = document.createElement('input')
    search.className = 'search'
    search.placeholder = 'Search notes'
    search.value = query
    search.setAttribute('autocomplete', 'off')
    const grid = document.createElement('div')
    grid.className = 'list'
    const fill = () => {
      grid.innerHTML = ''
      const shown = notes.filter((n) => n.text.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.at - a.at)
      if (!shown.length) {
        const e = document.createElement('div')
        e.className = 'empty'
        e.textContent = notes.length ? 'No matching notes' : 'No notes yet. Tap + to write one.'
        grid.append(e)
      }
      for (const n of shown) {
        const c = document.createElement('button')
        c.className = 'card'
        c.type = 'button'
        const [first, ...rest] = n.text.split('\n')
        const b = document.createElement('b')
        b.textContent = first || 'Untitled'
        const s = document.createElement('span')
        s.textContent = rest.join('\n').trim()
        c.append(b, s)
        c.onclick = () => edit(n)
        grid.append(c)
      }
    }
    search.oninput = () => {
      query = search.value
      fill()
    }
    fill()
    const fab = document.createElement('button')
    fab.className = 'fab'
    fab.type = 'button'
    fab.setAttribute('aria-label', 'New note')
    fab.textContent = '+'
    fab.onclick = () => edit({ id: String(Date.now()), text: '', at: Date.now() })
    el.append(h, search, grid, fab)
  }

  function edit(n: Note) {
    el.innerHTML = ''
    const bar = document.createElement('div')
    bar.className = 'bar'
    const back = document.createElement('button')
    back.type = 'button'
    back.setAttribute('aria-label', 'Back')
    back.innerHTML = BACK
    const del = document.createElement('button')
    del.type = 'button'
    del.setAttribute('aria-label', 'Delete')
    del.innerHTML = BIN
    bar.append(back, del)
    const ta = document.createElement('textarea')
    ta.value = n.text
    ta.placeholder = 'Note'
    ta.setAttribute('autocomplete', 'off')
    el.append(bar, ta)
    ta.focus()
    // The system's Back closes the note, as the arrow does (the page's address stays as it is).
    history.pushState({ decoy: 'note' }, '')
    let done = false
    const close = async (keep: boolean, fromPop = false) => {
      if (done) return
      done = true
      window.removeEventListener('popstate', onPop)
      if (!fromPop) history.back()
      const text = ta.value.replace(/\s+$/, '')
      notes = notes.filter((x) => x.id !== n.id)
      // The word on the first line: pawbs opens, and the note is not kept.
      if (keep && text && (await ctx.unlock(text.split('\n')[0]))) return save()
      if (keep && text.trim()) notes.push({ ...n, text, at: Date.now() })
      save()
      list()
    }
    const onPop = () => void close(true, true)
    window.addEventListener('popstate', onPop)
    back.onclick = () => void close(true)
    del.onclick = () => void close(false)
  }

  list()
}
