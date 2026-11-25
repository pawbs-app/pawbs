// Renders the app icon (public/icons/paw.svg) to the PNG sizes the web manifest and iOS need, favicon.ico, and the
// social preview card (public/og-image.png, 1200×630) shown when a link to the app is shared.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import * as fontkit from 'fontkit'
import woff2 from 'wawoff2'

import { PAW, BRACKETS } from './paw.mjs'

const mark = (inset) => {
  // The paw and the corner brackets, scaled into the safe area.
  const s = (512 - inset * 2) / 512
  return `<g transform="translate(${inset} ${inset}) scale(${s})">
    <path d="${BRACKETS}" fill="none" stroke="#9b9b9b" stroke-width="14" stroke-linecap="square"/>
    <g fill="#f2f2f2">${PAW}</g>
  </g>`
}
const svg = (inset, rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" ${rounded ? 'rx="96"' : ''} fill="#000"/>${mark(inset)}</svg>`

/* Where they go. The page and the manifest use public/icons/: give that folder (or the files) a new
   name whenever the icon changes, so no cache (the CDN, the browser's favicon store, the installed
   app's offline copy) can keep serving the old picture under the same address. The files at the
   root (favicon.ico, favicon.svg, apple-touch-icon.png) are the conventional addresses browsers and
   crawlers ask for on their own. */
mkdirSync('public/icons', { recursive: true })
const icon = svg(0, true) + '\n'
writeFileSync('public/icons/paw.svg', icon)
writeFileSync('public/favicon.svg', icon)
const png = (src, size) => new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng()
const render = (src, size, out) => {
  const data = png(src, size)
  writeFileSync(out, data)
  console.log(out, data.length)
}
render(svg(0, true), 48, 'public/icons/paw-48.png')
render(svg(0, true), 192, 'public/icons/paw-192.png')
render(svg(0, true), 512, 'public/icons/paw-512.png')
render(svg(56, false), 512, 'public/icons/paw-maskable-512.png')
render(svg(24, false), 180, 'public/icons/paw-180.png')
render(svg(24, false), 180, 'public/apple-touch-icon.png')

/** favicon.ico: PNG images (16, 32, 48) in an ICO container. */
const sizes = [16, 32, 48]
const images = sizes.map((s) => png(svg(0, true), s))
const head = Buffer.alloc(6 + 16 * images.length)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2) // type: icon
head.writeUInt16LE(images.length, 4)
let offset = head.length
images.forEach((img, i) => {
  const e = 6 + 16 * i
  head.writeUInt8(sizes[i], e)
  head.writeUInt8(sizes[i], e + 1)
  head.writeUInt16LE(1, e + 4) // colour planes
  head.writeUInt16LE(32, e + 6) // bits per pixel
  head.writeUInt32LE(img.length, e + 8)
  head.writeUInt32LE(offset, e + 12)
  offset += img.length
})
writeFileSync('public/favicon.ico', Buffer.concat([head, ...images]))
console.log('public/favicon.ico', offset)

/* ---- Social preview: the app's typeface (Azeret Mono, variable) turned into outlines, so the
   picture needs no installed font and comes out the same anywhere. ---- */
// fontkit's weights (getVariation) work on TrueType only, not on the WOFF2 file itself: unpack it first.
const face = fontkit.create(Buffer.from(await woff2.decompress(readFileSync('src/assets/fonts/azeret-mono-latin-wght-normal.woff2'))))
/** One line of text as an SVG path: x, y = start of the baseline, size in px, letter spacing in em. */
function text(str, { x, y, size, weight, spacing = 0, fill }) {
  const f = face.getVariation({ wght: weight })
  const k = size / f.unitsPerEm
  const run = f.layout(str)
  let pen = 0
  let d = ''
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i]
    const t = `translate(${(x + (pen + pos.xOffset) * k).toFixed(2)} ${y}) scale(${k} ${-k})`
    d += `<path transform="${t}" d="${g.path.toSVG()}"/>`
    pen += pos.xAdvance + spacing * f.unitsPerEm
  })
  return { svg: `<g fill="${fill}">${d}</g>`, width: (pen - spacing * f.unitsPerEm) * k }
}
const W = 1200
const H = 630
const corner = (x, y, dx, dy, len, c, w) => `<path d="M${x} ${y + dy * len}V${y}H${x + dx * len}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="square"/>`
const frame = [corner(40, 40, 1, 1, 34, '#6a6a6a', 3), corner(W - 40, 40, -1, 1, 34, '#6a6a6a', 3), corner(40, H - 40, 1, -1, 34, '#6a6a6a', 3), corner(W - 40, H - 40, -1, -1, 34, '#6a6a6a', 3)].join('')
const name = text('pawbs', { x: 470, y: 318, size: 168, weight: 800, spacing: -0.02, fill: '#f2f2f2' })
const lede1 = text('Fast, private gallery viewer', { x: 476, y: 392, size: 32, weight: 500, fill: '#b4b4b4' })
const lede2 = text('for image boards', { x: 476, y: 438, size: 32, weight: 500, fill: '#b4b4b4' })
const host = text('PAWBS.APP', { x: 112, y: H - 92, size: 20, weight: 600, spacing: 0.16, fill: '#848484' })
const meta = text('NO TRACKING // INSTALLABLE // OFFLINE', { x: 0, y: H - 92, size: 20, weight: 600, spacing: 0.16, fill: '#848484' })
const metaRight = meta.svg.replace('<g ', `<g transform="translate(${W - 112 - meta.width} 0)" `)
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#000"/>
  ${frame}
  <g transform="translate(96 99) scale(0.66)">
    <path d="${BRACKETS}" fill="none" stroke="#9b9b9b" stroke-width="14" stroke-linecap="square"/>
    <g fill="#f2f2f2">${PAW}</g>
  </g>
  ${name.svg}${lede1.svg}${lede2.svg}
  <path d="M112 ${H - 132}H${W - 112}" stroke="#2a2a2a" stroke-width="2"/>
  ${host.svg}${metaRight}
</svg>`
render(og, W, 'public/og-image.png')
