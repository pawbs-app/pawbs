/* The Timer disguise (src/disguise.ts): an ordinary countdown that works. Set to the code given with
   the disguise (12:34 for 1234) and started, it opens pawbs instead. Its own small chunk, no Vue,
   nothing of pawbs. */
import type { DecoyContext } from '../disguise'

const CSS = `
.dk-timer{--bg:#fff;--track:#e6f1fb;--chip:#f1efe8;--text:#2c2c2a;--muted:#888780;position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;background:var(--bg);color:var(--text);font:16px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
@media (prefers-color-scheme:dark){.dk-timer{--bg:#121212;--track:#2a2a28;--chip:#2a2a28;--text:#f1efe8;--muted:#a8a69d}}
.dk-timer h1{align-self:stretch;margin:0;padding:18px;font-size:26px;font-weight:600}
.dk-timer .dial{position:relative;width:min(72vw,300px);aspect-ratio:1;margin-top:4vh}
.dk-timer .dial svg{position:absolute;inset:0;transform:rotate(-90deg)}
.dk-timer .time{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:2px;font-size:clamp(40px,13vw,60px);font-weight:300;font-variant-numeric:tabular-nums}
.dk-timer .time input{all:unset;width:1.25em;text-align:center;border-radius:10px;user-select:text;-webkit-user-select:text}
.dk-timer .time input:focus{background:var(--chip)}
.dk-timer .chips{display:flex;gap:8px;margin-top:28px}
.dk-timer .chips button{all:unset;padding:7px 14px;border-radius:16px;background:var(--chip);font-size:14px;cursor:pointer}
.dk-timer .ctl{margin-top:auto;margin-bottom:calc(36px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:36px}
.dk-timer .ctl button{all:unset;display:grid;place-items:center;border-radius:50%;cursor:pointer}
.dk-timer .ctl .reset{width:56px;height:56px;background:var(--chip);color:var(--muted)}
.dk-timer .ctl .go{width:76px;height:76px;background:var(--accent);color:#fff}
`
const PLAY = '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const PAUSE = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
const RESET = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>'
const R = 46

export function mount(root: HTMLElement, ctx: DecoyContext) {
  const style = document.createElement('style')
  style.textContent = CSS
  const el = document.createElement('div')
  el.className = 'dk-timer'
  el.style.setProperty('--accent', ctx.color)
  el.innerHTML = `<h1></h1>
    <div class="dial"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--track)" stroke-width="5"/><circle class="arc" cx="50" cy="50" r="${R}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round"/></svg>
      <div class="time"><input class="mm" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="Minutes"/>:<input class="ss" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="Seconds"/></div></div>
    <div class="chips"></div>
    <div class="ctl"><button class="reset" type="button" aria-label="Reset">${RESET}</button><button class="go" type="button" aria-label="Start">${PLAY}</button></div>`
  ;(el.querySelector('h1') as HTMLElement).textContent = ctx.name
  const mm = el.querySelector('.mm') as HTMLInputElement
  const ss = el.querySelector('.ss') as HTMLInputElement
  const arc = el.querySelector('.arc') as SVGCircleElement
  const go = el.querySelector('.go') as HTMLButtonElement
  const reset = el.querySelector('.reset') as HTMLButtonElement
  const chips = el.querySelector('.chips') as HTMLElement
  root.append(style, el)

  const C = 2 * Math.PI * R
  arc.style.strokeDasharray = String(C)
  let total = 300
  let left = 300
  let endAt = 0
  let tick = 0
  const pad = (n: number) => String(n).padStart(2, '0')
  const show = () => {
    mm.value = pad(Math.floor(left / 60))
    ss.value = pad(Math.floor(left % 60))
    arc.style.strokeDashoffset = String(C * (1 - (total ? left / total : 0)))
  }
  const setTo = (secs: number) => {
    stop()
    total = left = Math.max(0, Math.min(99 * 60 + 59, Math.round(secs)))
    show()
  }
  const read = () => (parseInt(mm.value || '0', 10) || 0) * 60 + Math.min(59, parseInt(ss.value || '0', 10) || 0)
  for (const m of [1, 5, 10]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = `${m} min`
    b.onclick = () => setTo(m * 60)
    chips.append(b)
  }
  for (const f of [mm, ss]) {
    f.onfocus = () => f.select()
    f.oninput = () => (f.value = f.value.replace(/\D/g, '').slice(0, 2))
    f.onchange = () => setTo(read())
  }

  /* The button's icon, changed only when it changes: pressing Start first commits a field being
     edited (setTo, stop), and an icon redrawn under the finger would lose the click. */
  function face(label: 'Start' | 'Pause') {
    if (go.getAttribute('aria-label') === label) return
    go.innerHTML = label === 'Start' ? PLAY : PAUSE
    go.setAttribute('aria-label', label)
  }
  function stop() {
    if (tick) clearInterval(tick)
    tick = 0
    face('Start')
    mm.readOnly = ss.readOnly = false
  }
  function ring() {
    navigator.vibrate?.([300, 150, 300])
    try {
      const ac = new AudioContext()
      for (let i = 0; i < 3; i++) {
        const o = ac.createOscillator()
        const g = ac.createGain()
        o.frequency.value = 880
        g.gain.setValueAtTime(0.2, ac.currentTime + i * 0.35)
        g.gain.setValueAtTime(0, ac.currentTime + i * 0.35 + 0.2)
        o.connect(g).connect(ac.destination)
        o.start(ac.currentTime + i * 0.35)
        o.stop(ac.currentTime + i * 0.35 + 0.22)
      }
    } catch {
      /* no sound here */
    }
  }
  go.onclick = async () => {
    if (tick) {
      left = Math.max(0, (endAt - Date.now()) / 1000)
      stop()
      return
    }
    // A fresh start on exactly the code: pawbs opens instead.
    const fields = mm.value.padStart(2, '0') + ss.value.padStart(2, '0')
    if (left === total && (await ctx.unlock(fields))) return
    if (left === total) setTo(read())
    if (left <= 0) return
    endAt = Date.now() + left * 1000
    mm.readOnly = ss.readOnly = true
    face('Pause')
    tick = window.setInterval(() => {
      left = Math.max(0, (endAt - Date.now()) / 1000)
      show()
      if (left <= 0) {
        stop()
        ring()
        left = total
        show()
      }
    }, 250)
  }
  reset.onclick = () => setTo(total)
  show()
}
