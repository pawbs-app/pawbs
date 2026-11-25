// Writes the static pages (site/pages.mjs) into dist/ after `vite build`, and dist/sitemap.xml.
// They use the app's own stylesheet and typeface (their hashed names read from dist/index.html), a
// title bar like the app's, and no script: crawlers and visitors without JavaScript read them whole.
// nginx serves dist/<slug>.html at /<slug> (deploy/nginx.conf), the service worker leaves these
// addresses to the network (vite.config.ts), and `npm run preview` maps them the same way.
import { readFileSync, writeFileSync } from 'node:fs'
import { pages, faq } from '../site/pages.mjs'
import { PAW } from './paw.mjs'

const ORIGIN = 'https://pawbs.app'
const slugs = JSON.parse(readFileSync('site/slugs.json', 'utf8'))
if (JSON.stringify(slugs) !== JSON.stringify(pages.map((p) => p.slug))) {
  throw new Error('site/slugs.json must list the slugs of site/pages.mjs, in order')
}
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const today = new Date().toISOString().slice(0, 10)

const index = readFileSync('dist/index.html', 'utf8')
const css = index.match(/href="\.\/(assets\/style-[\w-]+\.css)"/)?.[1]
const font = index.match(/rel="preload" href="\.\/(assets\/azeret-mono-latin-wght-normal-[\w-]+\.woff2)"/)?.[1]
if (!css || !font) throw new Error('site-pages: stylesheet or font not found in dist/index.html')

// The paw of the title bar (scripts/paw.mjs: one source for the mark's shapes).
const paw = `<svg class="paw" viewBox="128 133 256 256" aria-hidden="true" focusable="false"><g fill="currentColor">${PAW.replace(/\s+/g, ' ')}</g></svg>`

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/* The page stylesheet, on top of the app's (tokens, rv- components). Reading pages: selectable text,
   a little larger than the app's interface text, one readable column. */
const pageCss = `
html { user-select: text; cursor: auto; scroll-padding-top: calc(var(--bar-h) + 12px); }
body.site { font-size: 0.8125rem; line-height: 1.7; }
.sbar { position: sticky; top: 0; z-index: 10; height: var(--bar-h); }
.sbar .brand { color: var(--text); font-size: 1rem; text-decoration: none; flex: none; }
.sbar .brand:hover { background: var(--hover); }
.paw { display: block; width: 1em; height: 1em; }
.snav { display: flex; align-self: stretch; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.snav::-webkit-scrollbar { display: none; }
.snav a { display: flex; align-items: center; padding: 0 11px; color: var(--text-2); text-decoration: none; font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; border-top: 2px solid transparent; border-bottom: 2px solid transparent; }
.snav a:hover { color: var(--text); background: var(--hover); }
.snav a[aria-current='page'] { color: var(--text); border-bottom-color: var(--text); }
.sbar .open { flex: none; margin: 0 8px; }
.sp { max-width: 760px; margin: 0 auto; padding: 28px 16px 56px; }
.crumbs { margin: 0; }
.crumbs a { color: inherit; text-decoration: none; }
.crumbs a:hover { color: var(--text); }
.sp h1 { display: flex; align-items: center; gap: 0.35em; margin: 12px 0 14px; font-size: 1.875rem; line-height: 1.2; font-weight: 800; letter-spacing: -0.01em; color: var(--text); text-wrap: balance; }
.sp .lede { margin: 0 0 8px; max-width: 64ch; color: var(--text); font-size: 0.9375rem; line-height: 1.65; text-wrap: pretty; }
.sp h2 { display: flex; align-items: center; gap: 10px; margin: 40px 0 14px; font-size: 0.6875rem; font-weight: 400; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-3); }
.sp h2::before { content: '//'; }
.sp h2::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.sp h3 { margin: 22px 0 4px; font-size: 0.875rem; line-height: 1.45; color: var(--text); text-wrap: balance; }
.sp p { margin: 0 0 12px; max-width: 68ch; color: var(--text-2); text-wrap: pretty; }
.sp b { color: var(--text); font-weight: 600; }
.sp a:not(.rv-btn) { color: var(--text); text-underline-offset: 3px; text-decoration-color: var(--line-3); }
.sp a:not(.rv-btn):hover { text-decoration-color: var(--text); }
.sp code { color: var(--text); }
kbd { display: inline-block; min-width: 1.8em; padding: 0 4px; font: inherit; font-size: 0.75rem; line-height: 1.5; text-align: center; color: var(--text); border: 1px solid var(--line-2); }
.list { margin: 0 0 12px; padding: 0; list-style: none; }
.list li { position: relative; margin: 0 0 8px; padding-left: 3ch; color: var(--text-2); text-wrap: pretty; }
.list li::before { content: '//'; position: absolute; left: 0; color: var(--text-3); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.card { padding: 14px 16px 4px; border: 1px solid var(--line-2); background: var(--panel); }
.card h3 { margin-top: 0; }
.card p { font-size: 0.75rem; }
.steps { margin: 0 0 12px; padding: 0; list-style: none; counter-reset: step; }
.steps li { position: relative; margin: 0 0 10px; padding-left: 5ch; color: var(--text-2); counter-increment: step; text-wrap: pretty; }
.steps li::before { content: counter(step, decimal-leading-zero); position: absolute; left: 0; top: 0.1em; padding: 0 5px; font-size: 0.6875rem; line-height: 1.6; letter-spacing: 0.08em; color: var(--text); border: 1px solid var(--line-3); }
.note { padding-left: 12px; border-left: 1px solid var(--line-3); font-size: 0.75rem; }
.faq-q { margin-top: 26px; }
.cta { --bc: var(--text-3); --bs: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 48px; padding: 22px; }
.cta p { flex: 1 1 260px; margin: 0; color: var(--text); }
.sfoot { border-top: 1px solid var(--line); }
.sfoot .in { max-width: 760px; margin: 0 auto; padding: 20px 16px 36px; display: grid; gap: 12px; }
.sfoot nav { display: flex; flex-wrap: wrap; gap: 4px 18px; }
.sfoot nav a { color: var(--text-2); text-decoration: none; font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; }
.sfoot nav a:hover { color: var(--text); }
.sfoot p { margin: 0; color: var(--text-3); font-size: 0.6875rem; }
.sfoot p a { color: var(--text-2); }
/* Contact and version: spaced apart like the links above, each kept whole (no separator to strand). */
.sfoot .meta { display: flex; flex-wrap: wrap; gap: 2px 18px; }
.sfoot .meta span { white-space: nowrap; }
@media (max-width: 560px) {
  /* The nav scrolls sideways here: its right edge fades to say there is more. */
  .snav { mask-image: linear-gradient(to right, #000 80%, transparent); }
  .sp { padding-top: 20px; }
  .sp h1 { font-size: 1.5rem; }
  .sp .lede { font-size: 0.875rem; }
  .sbar .open { margin: 0 6px; padding: 2px 10px; }
}`

// The title bar links the main pages (not those with `top: false`); the footer lists every page.
const navLinks = (current, list = pages) => list.map((p) => `<a href="/${p.slug}"${p.slug === current ? ' aria-current="page"' : ''}>${p.nav}</a>`).join('')
const topPages = pages.filter((p) => p.top !== false)
for (const p of pages) {
  if (!/^\d{4}-\d\d-\d\d$/.test(p.updated ?? '')) throw new Error(`site-pages: /${p.slug} needs an "updated" date (YYYY-MM-DD)`)
}
// The day the static pages went up; a page added later says its own with `published`.
const PUBLISHED = '2026-11-23'
const OG_ALT = 'The pawbs paw mark beside the name: fast, private gallery viewer for image boards.'
// Where the code is (open source, GNU AGPL-3.0): footer, structured data.
const REPO = 'https://github.com/pawbs-app/pawbs'
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html'

function faqHtml() {
  return faq.map((g) => `\n<h2>${g.group}</h2>\n` + g.items.map(([q, a]) => `<h3 class="faq-q">${q}</h3>\n<p>${a}</p>`).join('\n')).join('\n')
}

function structuredData(p) {
  const url = `${ORIGIN}/${p.slug}`
  // Links in the FAQ's answers are written from the site's root: whole addresses in the data.
  const abs = (html) => html.replace(/href="\//g, `href="${ORIGIN}/`)
  const graph = [
    {
      '@type': p.faq ? 'FAQPage' : p.slug === 'about' ? 'AboutPage' : 'WebPage',
      '@id': `${url}#page`,
      url,
      name: p.title,
      description: p.description,
      inLanguage: 'en',
      datePublished: p.published ?? PUBLISHED,
      dateModified: p.updated,
      isPartOf: { '@id': `${ORIGIN}/#website` },
      about: { '@id': `${ORIGIN}/#app` },
      publisher: { '@id': `${ORIGIN}/#org` },
      primaryImageOfPage: { '@type': 'ImageObject', url: `${ORIGIN}/og-image.png`, width: 1200, height: 630 },
      breadcrumb: { '@id': `${url}#breadcrumb` },
      ...(p.faq && {
        mainEntity: faq.flatMap((g) => g.items).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: abs(a) } })),
      }),
    },
    // The site, its publisher and the app, named here too: a reference to the home page's data alone
    // is not followed from another page.
    { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: 'pawbs', inLanguage: 'en', publisher: { '@id': `${ORIGIN}/#org` } },
    { '@type': 'Organization', '@id': `${ORIGIN}/#org`, name: 'pawbs', url: `${ORIGIN}/`, logo: `${ORIGIN}/icons/paw-512.png`, email: 'contact@pawbs.app', sameAs: ['https://github.com/pawbs-app', 'https://gitlab.com/pawbs.app'] },
    {
      '@type': 'WebApplication',
      '@id': `${ORIGIN}/#app`,
      name: 'pawbs',
      url: `${ORIGIN}/`,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any (web browser): Windows, macOS, Linux, ChromeOS, Android, iOS, iPadOS',
      license: LICENSE_URL,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': `${ORIGIN}/#source`,
      name: 'pawbs source code',
      codeRepository: REPO,
      license: LICENSE_URL,
      programmingLanguage: ['TypeScript', 'Vue'],
      targetProduct: { '@id': `${ORIGIN}/#app` },
      author: { '@id': `${ORIGIN}/#org` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'pawbs', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: p.crumb, item: url },
      ],
    },
  ]
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 1).replace(/</g, '\\u003c')
}

function page(p) {
  const url = `${ORIGIN}/${p.slug}`
  const body = p.faq ? faqHtml() : p.body
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#010101">
<meta name="color-scheme" content="dark">
<meta name="text-scale" content="scale">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="pawbs">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="${ORIGIN}/og-image.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${OG_ALT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${ORIGIN}/og-image.png">
<meta name="twitter:image:alt" content="${OG_ALT}">
<link rel="icon" href="/icons/paw.svg" type="image/svg+xml">
<link rel="icon" href="/icons/paw-48.png" type="image/png" sizes="48x48">
<link rel="apple-touch-icon" href="/icons/paw-180.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/${font}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/${css}">
<style>${pageCss}
</style>
<script type="application/ld+json">
${structuredData(p)}
</script>
</head>
<body class="site">
<header class="rv-titlebar sbar">
  <a class="brand" href="/" title="pawbs // Open the app" aria-label="pawbs, open the app">${paw}</a>
  <nav class="snav" aria-label="Pages">${navLinks(p.slug, topPages)}</nav>
  <a class="rv-btn rv-btn--sm rv-btn--primary open" href="/">Open pawbs</a>
</header>
<main class="sp">
  <p class="crumbs rv-label"><a href="/">pawbs</a> // ${p.crumb}</p>
  <h1>${p.h1}</h1>
  <p class="lede">${p.lede}</p>
${body}
  <section class="cta rv-brackets" aria-label="Open pawbs">
    <p>Free and open source, no ads, no account needed. Pick e621 or e926 and start browsing.</p>
    <a class="rv-btn rv-btn--primary" href="/">Open pawbs</a>
    ${p.slug === 'install' ? '<a class="rv-btn" href="/features">See the features</a>' : '<a class="rv-btn" href="/install">How to install</a>'}
  </section>
</main>
<footer class="sfoot">
  <div class="in">
    <nav aria-label="All pages"><a href="/">Open pawbs</a>${navLinks('')}</nav>
    <p>pawbs is an independent, open-source project (<a href="${REPO}/blob/main/LICENSE">GNU AGPL-3.0</a>), not affiliated with e621 or e926.</p>
    <p class="meta"><span>Contact: <a href="mailto:contact@pawbs.app">contact@pawbs.app</a></span><span>Source code: <a href="${REPO}">GitHub</a></span><span>Version ${version}</span></p>
  </div>
</footer>
</body>
</html>
`
}

for (const p of pages) {
  const html = page(p)
  // Every page says what it is in plain text: a title, a description, an H1 and some substance.
  if (text(html.slice(html.indexOf('<main'))).split(' ').length < 120) throw new Error(`site-pages: /${p.slug} is too thin`)
  writeFileSync(`dist/${p.slug}.html`, html)
  console.log(`dist/${p.slug}.html`, html.length)
}

// lastmod: the day each page's text last changed (`updated`), so the dates mean something to a
// crawler; the app's own page changes with every build.
const urls = [[`${ORIGIN}/`, today], ...pages.map((p) => [`${ORIGIN}/${p.slug}`, p.updated])]
writeFileSync(
  'dist/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${d}</lastmod>\n  </url>`).join('\n')}\n</urlset>\n`,
)
console.log('dist/sitemap.xml', urls.length, 'addresses')
