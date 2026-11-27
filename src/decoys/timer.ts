/* The Timer disguise (src/disguise.ts): an ordinary countdown that works. Its time is typed in one
   go, as on a phone's clock: tap it, and digits fill it from the right (1, 13, 135, 1357 make
   13:57). Set to the code given with the disguise (1234 makes 12:34) and started, it opens pawbs
   instead. Its own small chunk, no Vue, nothing of pawbs. */
import type { DecoyContext } from '../disguise'

const CSS = `
.dk-timer{--bg:#fff;--track:#e6f1fb;--chip:#f1efe8;--text:#2c2c2a;--muted:#888780;position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;background:var(--bg);color:var(--text);font:16px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
@media (prefers-color-scheme:dark){.dk-timer{--bg:#121212;--track:#2a2a28;--chip:#2a2a28;--text:#f1efe8;--muted:#a8a69d}}
.dk-timer h1{align-self:stretch;margin:0;padding:18px;font-size:26px;font-weight:600}
.dk-timer .dial{position:relative;width:min(72vw,300px);aspect-ratio:1;margin-top:4vh}
.dk-timer .dial svg{position:absolute;inset:0;transform:rotate(-90deg)}
.dk-timer .time{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:2px;font-size:clamp(40px,13vw,60px);font-weight:300;font-variant-numeric:tabular-nums}
.dk-timer .digits{padding:0 .18em;border-radius:12px}
.dk-timer .time.editing .digits{background:var(--chip)}
.dk-timer .time.editing.fresh .digits{color:var(--muted)}
.dk-timer .time.editing .digits::after{content:'';display:inline-block;width:2px;height:.75em;margin-left:3px;vertical-align:-.04em;background:var(--accent);animation:dk-blink 1s steps(1) infinite}
@keyframes dk-blink{50%{opacity:0}}
.dk-timer .entry{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;border-radius:50%;opacity:0;font-size:16px;caret-color:transparent;cursor:pointer}
.dk-timer .entry:disabled{cursor:default}
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
      <div class="time"><span class="digits" aria-hidden="true"></span><input class="entry" inputmode="numeric" maxlength="4" autocomplete="off" aria-label="Time, minutes and seconds"/></div></div>
    <div class="chips"></div>
    <div class="ctl"><button class="reset" type="button" aria-label="Reset">${RESET}</button><button class="go" type="button" aria-label="Start">${PLAY}</button></div>`
  ;(el.querySelector('h1') as HTMLElement).textContent = ctx.name
  const time = el.querySelector('.time') as HTMLElement
  const digits = el.querySelector('.digits') as HTMLElement
  const entry = el.querySelector('.entry') as HTMLInputElement
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
  /* What is being typed (null: nothing): up to four digits, the last ones the seconds. */
  let typed: string | null = null
  const show = () => {
    const d = typed !== null ? typed.padStart(4, '0') : pad(Math.floor(left / 60)) + pad(Math.floor(left % 60))
    digits.textContent = `${d.slice(0, 2)}:${d.slice(2)}`
    time.classList.toggle('editing', typed !== null)
    time.classList.toggle('fresh', typed === '')
    arc.style.strokeDashoffset = String(C * (1 - (total ? left / total : 0)))
  }
  const setTo = (secs: number) => {
    stop()
    total = left = Math.max(0, Math.min(99 * 60 + 59, Math.round(secs)))
    show()
  }
  for (const m of [1, 5, 10]) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = `${m} min`
    b.onclick = () => setTo(m * 60)
    chips.append(b)
  }
  entry.onfocus = () => {
    typed = entry.value = ''
    show()
  }
  entry.oninput = () => {
    typed = entry.value = entry.value.replace(/\D/g, '').slice(-4)
    show()
  }
  // Done typing (Enter, a tap elsewhere, Start): the time typed, its seconds past 59 carried over
  // (12:90 is 13:30); nothing typed keeps the time it had.
  entry.onblur = () => {
    const t = typed
    typed = null
    if (t) setTo(Number(t.slice(0, -2) || 0) * 60 + Number(t.slice(-2)))
    else show()
  }
  entry.onkeydown = (e) => {
    if (e.key === 'Enter') entry.blur()
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
    entry.disabled = false
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
    if (left === total && (await ctx.unlock(pad(Math.floor(total / 60)) + pad(total % 60)))) return
    if (left <= 0) return
    endAt = Date.now() + left * 1000
    entry.disabled = true
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
