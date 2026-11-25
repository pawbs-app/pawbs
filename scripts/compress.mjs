// Pre-compresses the build: next to each text file, a Brotli (.br, maximum quality) and a gzip (.gz,
// level 9) copy, which nginx serves as they are (brotli_static / gzip_static). Compressing once at
// build time allows the slowest, smallest settings; the CDN in front caches what nginx sends.
// The service worker's precache list was written before this runs, so it never lists these copies.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const TEXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.xml'])
const MIN_SIZE = 512 // smaller files gain nothing worth a second request path
const MIN_GAIN = 0.9 // keep a copy only if it is at least 10% smaller

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else yield p
  }
}

let raw = 0
let br = 0
let gz = 0
let count = 0
for (const file of files(DIST)) {
  if (!TEXT.has(extname(file))) continue
  const data = readFileSync(file)
  if (data.length < MIN_SIZE) continue
  const b = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  })
  const g = gzipSync(data, { level: 9 })
  if (b.length < data.length * MIN_GAIN) writeFileSync(file + '.br', b)
  if (g.length < data.length * MIN_GAIN) writeFileSync(file + '.gz', g)
  raw += data.length
  br += Math.min(b.length, data.length)
  gz += Math.min(g.length, data.length)
  count++
}
const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log(`compressed ${count} files: ${kb(raw)} → brotli ${kb(br)}, gzip ${kb(gz)}`)
