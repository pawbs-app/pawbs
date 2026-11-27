// Renders the disguises' icons (src/services/disguise.ts, deploy/disguise.js): a plain white glyph
// (calculator, note, stopwatch) on each of the icon colours, like any app's. Written to
// public/as/icons/<kind>-<colour>-<size>.png: 192 and 512 with rounded corners, m512 full-bleed for
// masks (the glyph inside the safe zone). Run after changing a glyph or the colours:
//   node scripts/make-disguise-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const COLORS = ['5f5e5a', 'ef9f27', '1d9e75', '185fa5', '534ab7', 'd85a30']
const W = 'stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"'
const GLYPHS = {
  calculator: `<rect x="29" y="17" width="42" height="66" rx="8" ${W}/>
    <rect x="37" y="26" width="26" height="12" rx="2.5" fill="#fff"/>
    ${[44, 56, 68].flatMap((y) => [40, 50, 60].map((x) => `<circle cx="${x}" cy="${y + 4}" r="3.4" fill="#fff"/>`)).join('')}`,
  notes: `<path d="M31 17h25l14 14v52H31z" ${W}/><path d="M56 17v14h14" ${W}/>
    <path d="M40 49h21M40 60h21M40 71h13" ${W}/>`,
  timer: `<circle cx="50" cy="56" r="25" ${W}/><path d="M50 56V43" ${W}/>
    <path d="M44 20h12M50 20v11" ${W}/><path d="M70 33l4-4" ${W}/>`,
}
const icon = (glyph, color, maskable) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  (maskable ? `<rect width="100" height="100" fill="#${color}"/>` : `<rect width="100" height="100" rx="22" fill="#${color}"/>`) +
  `<g transform="${maskable ? 'translate(50 50) scale(0.74) translate(-50 -50)' : ''}">${glyph}</g></svg>`
const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

const out = new URL('../public/as/icons/', import.meta.url)
mkdirSync(out, { recursive: true })
let n = 0
for (const [kind, glyph] of Object.entries(GLYPHS)) {
  for (const c of COLORS) {
    writeFileSync(new URL(`${kind}-${c}-192.png`, out), png(icon(glyph, c, false), 192))
    writeFileSync(new URL(`${kind}-${c}-512.png`, out), png(icon(glyph, c, false), 512))
    writeFileSync(new URL(`${kind}-${c}-m512.png`, out), png(icon(glyph, c, true), 512))
    n += 3
  }
}
console.log(`${n} icons in public/as/icons/`)
