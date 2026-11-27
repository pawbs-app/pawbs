// Disguises (src/services/disguise.ts), run by nginx (njs): the page and the web manifest of pawbs
// installed as an ordinary-looking app, made from the address itself, so that one image serves any
// name and colour, with no second instance and no other host.
//
//   GET /as/<kind>/?name=…&color=…                        the page: as.html with its head filled in
//   GET /as/<kind>/manifest.webmanifest?name=…&color=…    its manifest: an app of its own (its id)
//
// <kind>: calculator, notes or timer; name: up to 30 characters (the kind's name if none); color: one
// of COLORS (the kind's own if not). The page's address is the app's start and id, so the installed
// app keeps asking for the same manifest. as.html holds nothing that names pawbs, not even a comment
// (its source can be looked at); its <base href="/"> makes relative addresses start at the root.
// The dev server serves the same through manifestFor/pageFor (vite.config.ts).
import fs from 'fs'

const KINDS = { calculator: 'Calculator', notes: 'Notes', timer: 'Timer' }
const COLORS = ['5f5e5a', 'ef9f27', '1d9e75', '185fa5', '534ab7', 'd85a30']
const DEFAULT = { calculator: '5f5e5a', notes: 'ef9f27', timer: '185fa5' }
const MARK = /<!--DISGUISE-HEAD[^>]*-->/
const ROOT = '/usr/share/nginx/html'

function decode(s) {
  try {
    return decodeURIComponent(String(s || '').replace(/\+/g, ' '))
  } catch (e) {
    return ''
  }
}
function arg(query, key) {
  const parts = String(query || '').split('&')
  for (let i = 0; i < parts.length; i++) {
    const at = parts[i].indexOf('=')
    if ((at < 0 ? parts[i] : parts[i].slice(0, at)) === key) return decode(at < 0 ? '' : parts[i].slice(at + 1))
  }
  return ''
}
/** The disguise an address asks for, its values made safe. */
function read(kind, query) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return null
  const name = arg(query, 'name')
    .replace(/[\u0000-\u001f\u007f<>"'`&\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
  const color = arg(query, 'color').toLowerCase()
  return {
    kind,
    name: name || KINDS[kind],
    color: COLORS.indexOf(color) >= 0 ? color : DEFAULT[kind],
  }
}
function startOf(d) {
  return '/as/' + d.kind + '/?name=' + encodeURIComponent(d.name) + '&color=' + d.color
}
function icon(d, size) {
  return '/as/icons/' + d.kind + '-' + d.color + '-' + size + '.png'
}
function html(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function manifestFor(kind, query) {
  const d = read(kind, query)
  if (!d) return null
  const start = startOf(d)
  return {
    id: start,
    name: d.name,
    short_name: d.name,
    start_url: start,
    scope: '/as/' + d.kind + '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#' + d.color,
    icons: [
      { src: icon(d, '192'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon(d, '512'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icon(d, 'm512'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

function pageFor(template, kind, query) {
  const d = read(kind, query)
  if (!d) return null
  const q = start => start.slice(start.indexOf('?') + 1)
  const head =
    '<title>' + html(d.name) + '</title>\n' +
    '    <meta name="theme-color" content="#' + d.color + '" />\n' +
    '    <meta name="apple-mobile-web-app-title" content="' + html(d.name) + '" />\n' +
    '    <link rel="manifest" href="/as/' + d.kind + '/manifest.webmanifest?' + html(q(startOf(d))) + '" />\n' +
    '    <link rel="icon" href="' + icon(d, '192') + '" type="image/png" />\n' +
    '    <link rel="apple-touch-icon" href="' + icon(d, '192') + '" />'
  // (The build links the app's own manifest and stylesheet on every page: not this one's. The
  // stylesheet comes with the app, once unlocked, src/disguise.ts.)
  return String(template)
    .replace(/\s*<link rel="manifest" href="[^"]*manifest\.webmanifest"\s*\/?>/g, '')
    .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
    .replace(MARK, head)
}

function kindOf(uri) {
  const m = /^\/as\/([a-z]+)\//.exec(uri)
  return m ? m[1] : ''
}

function manifest(r) {
  const m = manifestFor(kindOf(r.uri), r.variables.args)
  if (!m) return r.return(404)
  r.headersOut['Content-Type'] = 'application/manifest+json'
  r.return(200, JSON.stringify(m))
}

function page(r) {
  let template
  try {
    template = fs.readFileSync(ROOT + '/as.html', 'utf8')
  } catch (e) {
    return r.return(404)
  }
  const out = pageFor(template, kindOf(r.uri), r.variables.args)
  if (!out) return r.return(404)
  r.headersOut['Content-Type'] = 'text/html; charset=utf-8'
  r.return(200, out)
}

export default { manifest, page, manifestFor, pageFor }
