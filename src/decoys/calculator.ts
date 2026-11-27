/* The Calculator disguise (src/disguise.ts): an ordinary calculator that works. The code set with the
   disguise, typed and followed by "=", opens pawbs. Its own small chunk, no Vue, nothing of pawbs. */
import type { DecoyContext } from '../disguise'

const CSS = `
.dk-calc{--bg:#fff;--key:#f1efe8;--fn:#d3d1c7;--text:#2c2c2a;--muted:#888780;position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:16px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
@media (prefers-color-scheme:dark){.dk-calc{--bg:#121212;--key:#2a2a28;--fn:#444441;--text:#f1efe8;--muted:#a8a69d}}
.dk-calc .screen{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;padding:16px 24px;min-height:0;overflow:hidden}
.dk-calc .expr{min-height:1.4em;color:var(--muted);font-size:20px}
.dk-calc .val{font-size:clamp(40px,14vw,72px);font-weight:300;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.dk-calc .keys{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 16px calc(20px + env(safe-area-inset-bottom));max-width:480px;width:100%;margin:0 auto;box-sizing:border-box}
.dk-calc button{all:unset;box-sizing:border-box;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;font-size:clamp(20px,6vw,28px);background:var(--key);color:var(--text);cursor:pointer;transition:filter .1s}
.dk-calc button:active{filter:brightness(.85)}
.dk-calc button.fn{background:var(--fn);font-size:clamp(17px,5vw,22px)}
.dk-calc button.op{background:var(--accent);color:#fff}
.dk-calc button.eq{background:var(--accent);color:#fff;filter:saturate(1.2) brightness(.9)}
`
const KEYS = ['AC', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '=']
const OPS = new Set(['÷', '×', '−', '+'])

export function mount(root: HTMLElement, ctx: DecoyContext) {
  const style = document.createElement('style')
  style.textContent = CSS
  const el = document.createElement('div')
  el.className = 'dk-calc'
  el.style.setProperty('--accent', ctx.color)
  el.innerHTML = `<div class="screen"><div class="expr"></div><div class="val">0</div></div><div class="keys"></div>`
  const exprEl = el.querySelector('.expr') as HTMLElement
  const valEl = el.querySelector('.val') as HTMLElement
  const keysEl = el.querySelector('.keys') as HTMLElement
  for (const k of KEYS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = k
    b.className = k === '=' ? 'eq' : OPS.has(k) ? 'op' : ['AC', '±', '%'].includes(k) ? 'fn' : ''
    b.setAttribute('aria-label', { '÷': 'divide', '×': 'times', '−': 'minus', '+': 'plus', '±': 'plus or minus', '⌫': 'delete', AC: 'clear' }[k] ?? k)
    b.onclick = () => press(k)
    keysEl.append(b)
  }
  root.append(style, el)

  let cur = '0'
  let acc: number | null = null
  let op: string | null = null
  let fresh = false
  // The digits typed since the last operator, clear or "=": what "=" tries as the code.
  let typed = ''

  const fmt = (n: number) => (Number.isFinite(n) ? String(parseFloat(n.toPrecision(12))) : 'Error')
  const apply = (a: number, b: number, o: string) => (o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b)
  const render = () => {
    valEl.textContent = cur
    exprEl.textContent = acc !== null && op ? `${fmt(acc)} ${op}` : ''
  }

  function press(k: string) {
    if (/^\d$/.test(k)) {
      cur = fresh || cur === '0' ? k : cur.length < 15 ? cur + k : cur
      fresh = false
      typed += k
    } else if (k === '.') {
      if (fresh) cur = '0.'
      else if (!cur.includes('.')) cur += '.'
      fresh = false
    } else if (k === '⌫') {
      if (!fresh) cur = cur.length > 1 ? cur.slice(0, -1) : '0'
      typed = typed.slice(0, -1)
    } else if (k === 'AC') {
      cur = '0'
      acc = null
      op = null
      typed = ''
    } else if (k === '±') {
      cur = cur.startsWith('-') ? cur.slice(1) : cur === '0' ? cur : `-${cur}`
    } else if (k === '%') {
      cur = fmt(parseFloat(cur) / 100)
      fresh = true
    } else if (OPS.has(k)) {
      if (op && acc !== null && !fresh) cur = fmt(apply(acc, parseFloat(cur), op))
      acc = parseFloat(cur)
      op = k
      fresh = true
      typed = ''
    } else if (k === '=') {
      const code = typed
      typed = ''
      if (op && acc !== null) cur = fmt(apply(acc, parseFloat(cur), op))
      acc = null
      op = null
      fresh = true
      render()
      void ctx.unlock(code)
      return
    }
    render()
  }

  const keyMap: Record<string, string> = { '/': '÷', '*': '×', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'AC', Delete: 'AC', ',': '.', '.': '.' }
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected) return window.removeEventListener('keydown', onKey)
    const k = /^\d$/.test(e.key) ? e.key : keyMap[e.key]
    if (!k || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    press(k)
  }
  window.addEventListener('keydown', onKey)
}
