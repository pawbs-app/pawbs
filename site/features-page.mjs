/* The features page (/features): what pawbs does, shown rather than told. A short hero, five themed
   sections with screenshots and short looping clips (public/site/features/, captured on e926), then
   every feature as theme cards: each theme's highlights first, the rest folded under them
   (site/features.mjs). Plain HTML like the other pages (scripts/site-pages.mjs): the folded lists
   are <details>, read whole by crawlers; clips loop muted, and with reduced motion their still shows
   instead. Facts must match the app, as on every page. */
import { featureIndex } from './features.mjs'

const M = '/site/features/'
const kbd = (k) => `<kbd>${k}</kbd>`
const count = featureIndex.reduce((n, t) => n + t.groups.reduce((m, g) => m + g.items.length, 0), 0)
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** A still: WebP, its size given so nothing jumps. */
const img = (name, w, h, alt, eager = false) =>
  `<img src="${M}${name}.webp" width="${w}" height="${h}" alt="${alt}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`
/** A looping clip: muted, inline, WebM first; its still for reduced motion (shown by CSS). */
const vid = (name, w, h, label) =>
  `<video autoplay muted loop playsinline preload="metadata" width="${w}" height="${h}" poster="${M}${name}-poster.webp" aria-label="${label}"><source src="${M}${name}.webm" type="video/webm"><source src="${M}${name}.mp4" type="video/mp4"></video><img class="still" src="${M}${name}-poster.webp" width="${w}" height="${h}" alt="${label}" loading="lazy" decoding="async">`
/** A computer window around a still or a clip. */
const win = (where, media) => `<figure class="win"><div class="win-bar" aria-hidden="true"><i></i><i></i><i></i><span>${where}</span></div>${media}</figure>`
/** A phone around a still or a clip. */
const phone = (media, cap = '') => `<figure class="phone"><div class="screen">${media}</div>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`

/* The clips, for the page and its structured data (VideoObject). */
const clips = {
  zoom: { w: 1280, h: 800, s: 6, name: 'Zooming into a picture with the mouse wheel', text: 'The mouse wheel glides into a landscape around the pointer, then back out, in the pawbs gallery on a computer.' },
  feed: { w: 540, h: 1142, s: 8, name: 'The Feed on a phone', text: 'The Feed layout of pawbs on an Android phone: one post a screen, snapping into place with each swipe.' },
  'swipe-zoom': { w: 540, h: 1142, s: 8, name: 'Swiping and double-tap zoom on a phone', text: 'Swiping from post to post in the pawbs gallery on a phone, then a double tap zooming into the picture.' },
  unlock: { w: 540, h: 1064, s: 8, name: 'The calculator disguise opening pawbs', text: 'pawbs installed as a calculator: it works as one (12 + 3 = 15), and the code followed by = opens pawbs.' },
  notes: { w: 540, h: 1064, s: 6, name: 'The notes disguise opening pawbs', text: 'pawbs installed as a notes app: an ordinary list of notes, and a new note whose first line is the secret word opens pawbs.' },
  timer: { w: 540, h: 1064, s: 7, name: 'The timer disguise opening pawbs', text: 'pawbs installed as a timer: set to the code as minutes and seconds (13:57) and started, it opens pawbs.' },
}
const clip = (key) => vid(key, clips[key].w, clips[key].h, clips[key].text)

/* The stills named in the structured data (screenshot). */
const stills = [
  ['search', 1440, 900, 'Search results in pawbs on a computer: a grid of fox pictures with the refine bar above.'],
  ['autocomplete', 1100, 493, 'Tag autocomplete in pawbs: suggestions with their category and post count.'],
  ['following', 1440, 900, 'The Following page in pawbs: followed tags and searches with new-post counts and one stream of their newest posts.'],
  ['phone-touch', 600, 1298, 'Touch settings of pawbs on a phone: double tap, hand, swipes, hold for 2x.'],
]
const alt = Object.fromEntries(stills.map(([n, , , a]) => [n, a]))

/* Each theme's card: its highlights (★: what sets pawbs apart), the full list folded under them. */
const cards = [
  ['search', 'Search', ['★ Tricky searches without learning the syntax', 'Suggestions as you type', 'Dig up older art by date']],
  ['gallery', 'Gallery and video', ['★ The next posts ready before you are', 'Comfortable on any screen size', 'A proper video player']],
  ['phone', 'On phones and tablets', ['A full-screen feed', 'Gestures set your way', 'Left- or right-pawed']],
  ['desktop', 'On computers', ['Browse from the keyboard', 'Smooth zoom with the wheel', 'Grab lots of posts at once']],
  ['following', 'Following', ['New posts from your faves, counted', '★ Syncs with your e621 follows', 'Bring your follows from another app']],
  ['keep', 'Favourites, collections, pools', ['Favourites, account or not', '★ Comics that remember your page', 'Collections of your own']],
  ['privacy', 'Privacy and security', ['★ Fully encrypted, unlocked with your fingerprint', '★ No browser history, if you like', '★ Hides as a calculator, notes app or timer']],
  ['blacklist', 'Blacklist', ['The same blacklist as on e621', 'Kept in step with your account', 'Only see what you want to see']],
  ['app', 'Installable app', ['★ On iPhone too, no app store', 'Starts even offline', 'Keeps itself up to date']],
  ['sync', 'Transfer and backup', ['★ Move to a new phone with a QR code', 'Backups, password-protected if you like']],
  ['accounts', 'Accounts and sites', ['No account needed', 'Your API key, never your password', 'Switch between e621 and e926']],
  ['speed', 'Performance', ['Adapts to slow connections', 'Easy on your data', 'Back is instant']],
  ['history', 'History', ['Find that post you saw yesterday', 'Hide what you’ve already seen']],
  ['settings', 'Look and settings', ['Lots of settings, sensible defaults', 'Effects you can turn off', 'Screen-reader friendly']],
  ['open', 'Open and independent', ['★ Free, no ads, open source', 'Run your own copy']],
]
const where = { pc: 'PC', phone: 'Phone' }
const byId = Object.fromEntries(featureIndex.map((t) => [t.id, t]))
const star = (x) => (x.startsWith('★ ') ? `<li class="star"><span class="sr">Standout: </span>${x.slice(2)}</li>` : `<li>${x}</li>`)
const grid = cards
  .map(([id, name, top], i) => {
    const t = byId[id]
    const n = t.groups.reduce((m, g) => m + g.items.length, 0)
    const all = t.groups
      .map((g) => (g.name ? `<h4>${g.name}</h4>` : '') + `<ul>${g.items.map(([w, x]) => `<li>${where[w] ? `<span class="w">${where[w]}</span> ` : ''}${x}</li>`).join('')}</ul>`)
      .join('\n')
    return `<section class="tcard" id="all-${id}" aria-labelledby="all-h-${id}">
  <p class="tnum rv-label">${String(i + 1).padStart(2, '0')} // ${n} features</p>
  <h3 id="all-h-${id}">${name}</h3>
  <ul class="top">${top.map(star).join('')}</ul>
  <details><summary>All ${n} features</summary>
${all}
  </details>
</section>`
  })
  .join('\n')

const css = `
.sp--wide { max-width: 1180px; }
.fp-hero { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 40px; align-items: center; padding: 4px 0 0; }
.fp-hero h1 { display: block; margin: 10px 0 16px; font-size: clamp(1.9rem, 3.8vw, 3rem); line-height: 1.08; letter-spacing: -0.02em; }
.fp-hero .lede { font-size: 0.9375rem; color: var(--text-2); max-width: 50ch; }
.fp-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 0; }
.stage { position: relative; padding: 0 9% 34px 0; }
.stage .phone { position: absolute; right: 0; bottom: 0; width: 29%; }
.win, .phone { margin: 0; }
.win { border: 1px solid var(--line-2); background: var(--panel); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55); }
.win-bar { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-bottom: 1px solid var(--line-2); }
.win-bar i { width: 7px; height: 7px; border: 1px solid var(--line-3); }
.win-bar span { margin-left: 8px; font-size: 0.625rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-3); }
.win img, .win video, .phone img, .phone video { display: block; width: 100%; height: auto; }
.phone .screen { padding: 6px; border: 1px solid var(--line-3); border-radius: 24px; background: #0c0c0c; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6); }
.phone .screen > img, .phone .screen > video { border-radius: 18px; }
.phone figcaption { padding: 8px 2px 0; font-size: 0.6875rem; line-height: 1.5; color: var(--text-3); text-align: center; }
.still { display: none !important; }
@media (prefers-reduced-motion: reduce) {
  .fp video, .fp-hero video { display: none !important; }
  .still { display: block !important; }
}
.facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 26px 0 0; padding: 0; list-style: none; }
.facts li { --bc: var(--text-3); --bs: 10px; padding: 10px 14px 9px; background-color: var(--panel); }
.facts b { display: block; font-size: 1.375rem; line-height: 1.1; font-weight: 800; color: var(--text); }
.facts span { font-size: 0.75rem; color: var(--text-2); }
.feat { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 44px; align-items: center; margin-top: 52px; }
.feat:nth-of-type(even) .feat-media { order: -1; }
.kicker { margin: 0 0 6px; }
.fp h2 { display: block; margin: 0 0 8px; font-size: clamp(1.4rem, 2.6vw, 2rem); line-height: 1.12; font-weight: 800; letter-spacing: -0.015em; text-transform: none; color: var(--text); text-wrap: balance; }
.fp h2::before, .fp h2::after { content: none; }
.feat-copy > p { font-size: 0.875rem; }
.ticks { margin: 10px 0 0; padding: 0; list-style: none; }
.ticks li { position: relative; margin: 0 0 5px; padding-left: 2.6ch; color: var(--text-2); font-size: 0.8125rem; text-wrap: pretty; }
.ticks li::before { content: '+'; position: absolute; left: 0; color: var(--text); }
.small { font-size: 0.75rem !important; color: var(--text-3) !important; }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 205px)); justify-content: center; gap: 20px; align-items: start; }
.trio { display: grid; grid-template-columns: repeat(3, minmax(0, 175px)); justify-content: center; gap: 14px; align-items: start; }
.all-head { margin-top: 60px; max-width: 760px; }
.legend { font-size: 0.75rem !important; }
.legend b { color: var(--text); }
.tgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; margin-top: 14px; align-items: start; }
.tcard { padding: 14px 16px 10px; border: 1px solid var(--line-2); background: var(--panel); }
.tnum { margin: 0 0 4px; }
.tcard h3 { margin: 0 0 8px; font-size: 1rem; }
.tcard .top { margin: 0 0 8px; padding: 0; list-style: none; }
.tcard .top li { position: relative; margin: 0 0 6px; padding-left: 2.4ch; font-size: 0.8125rem; line-height: 1.45; color: var(--text); }
.tcard .top li::before { content: '+'; position: absolute; left: 0; color: var(--text-3); }
.tcard .top li.star::before { content: '★'; color: var(--text); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tcard details { border-top: 1px solid var(--line); padding-top: 8px; }
.tcard summary { cursor: pointer; list-style: none; font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-2); }
.tcard summary::-webkit-details-marker { display: none; }
.tcard summary::before { content: '+ '; color: var(--text); }
.tcard details[open] summary::before { content: '− '; }
.tcard summary:hover { color: var(--text); }
.tcard h4 { margin: 12px 0 4px; font-size: 0.5625rem; font-weight: 400; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
.tcard details ul { margin: 6px 0 0; padding: 0; list-style: none; }
.tcard details li { margin: 0 0 5px; font-size: 0.6875rem; line-height: 1.55; color: var(--text-2); }
.w { display: inline-block; padding: 0 4px; border: 1px solid var(--line-3); font-size: 0.5625rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text); vertical-align: 0.1em; }
.credit { margin: 18px 0 0 !important; font-size: 0.6875rem !important; color: var(--text-3) !important; }
.ask { --bc: var(--text); --bs: 16px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; margin-top: 32px; padding: 26px 28px; background-color: #0d0d0d; box-shadow: inset 0 0 0 1px var(--line-2); }
.ask > div:first-child { flex: 1 1 360px; }
.fp .ask h2 { margin: 0 0 6px; font-size: clamp(1.25rem, 2.2vw, 1.625rem); }
.ask p { margin: 0; color: var(--text); font-size: 0.875rem; }
.ask-btns { display: flex; flex-wrap: wrap; gap: 10px; }
.lenny { font-family: system-ui, sans-serif; font-size: 1.15em; white-space: nowrap; }
.sp--wide .cta { margin-top: 20px; padding: 18px 20px; }
@media (max-width: 900px) {
  .fp-hero { grid-template-columns: minmax(0, 1fr); gap: 22px; }
  .feat { grid-template-columns: minmax(0, 1fr); gap: 18px; margin-top: 40px; }
  .feat:nth-of-type(even) .feat-media { order: 0; }
  .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 22px; }
}
@media (max-width: 560px) {
  .stage { padding: 0 14% 40px 0; }
  .stage .phone { width: 36%; }
  .pair { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .trio { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .phone .screen { padding: 4px; border-radius: 16px; }
  .phone .screen > img, .phone .screen > video { border-radius: 12px; }
  .tgrid { grid-template-columns: minmax(0, 1fr); }
}`

const hero = `  <section class="fp-hero" aria-labelledby="fp-title">
    <div>
      <h1 id="fp-title">Fast, private e621 and e926 browsing, made for paws</h1>
      <p class="lede">Find art fast, follow your favourite artists, read comics and keep it all private, in an app that’s quick, polished and set up your way. Free, no account needed.</p>
      <div class="fp-actions">
        <a class="rv-btn rv-btn--primary" href="/">Open pawbs</a>
        <a class="rv-btn" href="/install">Install it</a>
        <a class="rv-btn" href="#all">All ${count} features</a>
      </div>
    </div>
    <div class="stage">
      ${win('pawbs.app // search', img('search', 1440, 900, alt.search, true))}
      ${phone(clip('feed'))}
    </div>
  </section>`

const body = `
<div class="fp">
<ul class="facts" aria-label="pawbs in numbers">
  <li class="rv-brackets"><b>${count}</b><span>features</span></li>
  <li class="rv-brackets"><b>0</b><span>ads or trackers</span></li>
  <li class="rv-brackets"><b>7</b><span>platforms, no app store</span></li>
  <li class="rv-brackets"><b>100%</b><span>free and open source</span></li>
</ul>

<section class="feat" id="search" aria-labelledby="h-search">
  <div class="feat-copy">
    <p class="kicker rv-label">Search</p>
    <h2 id="h-search">What’s on the menu today?</h2>
    <p>Suggestions as you type, and a helper that builds e621’s trickier searches for you.</p>
    <ul class="ticks">
      <li>Your e621 blacklist works here too.</li>
      <li>Narrow things down in a tap, or dig up older art by date.</li>
    </ul>
  </div>
  <div class="feat-media">
    ${win('autocomplete', img('autocomplete', 1100, 493, alt.autocomplete))}
  </div>
</section>

<section class="feat" id="gallery" aria-labelledby="h-gallery">
  <div class="feat-copy">
    <p class="kicker rv-label">Gallery</p>
    <h2 id="h-gallery">No waiting, just browsing</h2>
    <p>The next posts are ready before you are, so a whole gallery just flows.</p>
    <ul class="ticks">
      <li>Pictures, videos and comics in one smooth viewer.</li>
      <li>Tags, artist and comments one tap away.</li>
    </ul>
  </div>
  <div class="feat-media">
    ${win('gallery // wheel zoom', clip('zoom'))}
  </div>
</section>

<section class="feat" id="phone" aria-labelledby="h-phone">
  <div class="feat-copy">
    <p class="kicker rv-label">Phones</p>
    <h2 id="h-phone">Feels right in your paws</h2>
    <p>A full-screen feed, gestures you pick yourself, and buttons on your thumb’s side.</p>
    <ul class="ticks">
      <li>Easy to use one-pawed <span class="lenny">( ͡° ͜ʖ ͡°)</span></li>
      <li>On iPhone and Android, no app store needed.</li>
      <li>Set it up just how you like it.</li>
    </ul>
  </div>
  <div class="feat-media pair">
    ${phone(clip('swipe-zoom'), 'Swipe through, tap twice to zoom')}
    ${phone(img('phone-touch', 600, 1298, alt['phone-touch']), 'Every gesture, your call')}
  </div>
</section>

<section class="feat" id="following" aria-labelledby="h-following">
  <div class="feat-copy">
    <p class="kicker rv-label">Following</p>
    <h2 id="h-following">Never miss new art from your faves</h2>
    <p>Follow artists, tags or whole searches, and see what’s new since your last visit.</p>
    <ul class="ticks">
      <li>Favourites and collections, with or without an account.</li>
      <li>Comics pick up right where you left off.</li>
    </ul>
  </div>
  <div class="feat-media">
    ${win('following', img('following', 1440, 900, alt.following))}
  </div>
</section>

<section class="feat" id="privacy" aria-labelledby="h-privacy">
  <div class="feat-copy">
    <p class="kicker rv-label">Privacy</p>
    <h2 id="h-privacy">What happens in the den stays in the den</h2>
    <p>No ads, no tracking: just you and e621.</p>
    <ul class="ticks">
      <li>Encrypt all your data, unlocked with your fingerprint, face or a password.</li>
      <li>Leave no trace in your browser history, if you like.</li>
      <li>Or hide it as a calculator, notes app or timer.</li>
    </ul>
    <p class="small"><a href="/privacy">Privacy</a> and <a href="/security">security</a> in detail.</p>
  </div>
  <div class="feat-media trio">
    ${phone(clip('unlock'), 'Calculator: code + =')}
    ${phone(clip('notes'), 'Notes: your word')}
    ${phone(clip('timer'), 'Timer: your code')}
  </div>
</section>

<section class="all-head" id="all" aria-labelledby="h-all">
  <p class="kicker rv-label">Everything</p>
  <h2 id="h-all">The whole pack: all ${count} features</h2>
  <p class="legend">Best bits first, the rest folded under. <b>★</b> marks the standouts.</p>
</section>
<div class="tgrid">
${grid}
</div>
<section class="ask rv-brackets" aria-labelledby="h-ask">
  <div>
    <h2 id="h-ask">Missing something? Found a bug?</h2>
    <p>I’d love to hear your ideas: send an email or open an issue on GitHub. I don’t bite.</p>
  </div>
  <div class="ask-btns">
    <a class="rv-btn rv-btn--primary" href="mailto:contact@pawbs.app?subject=pawbs%20idea">Email me</a>
    <a class="rv-btn" href="https://github.com/pawbs-app/pawbs/issues">Open an issue</a>
  </div>
</section>
</div>`

export const featuresPage = {
  slug: 'features',
  nav: 'Features',
  title: 'pawbs features: a fast, private e621 & e926 app for phone and PC',
  description: `Everything pawbs does, the free and private e621 and e926 app: tag autocomplete and a query assistant, a gallery that loads ahead, a swipeable feed, follows with new-post counts, a comic reader, encryption and disguises. All ${count} features.`,
  updated: '2026-11-27',
  crumb: 'Features',
  wide: true,
  hero,
  body,
  css,
  after: '  <p class="credit">All art: posts on e926, by their artists. Go give them some love.</p>\n',
  og: { src: `${M}og-features.jpg`, type: 'image/jpeg', width: 1200, height: 630, alt: 'pawbs on a computer, a grid of fox pictures, beside pawbs on a phone in its Feed layout.' },
  appData: (origin) => ({
    description: 'A free, open-source e621 and e926 viewer for phones, tablets and computers: fast search, a preloading gallery, followed tags, a pool reader, collections and privacy tools, with no ads and no tracking.',
    featureList: featureIndex.flatMap((t) => t.groups.flatMap((g) => g.items.map(([, x]) => plain(x)))),
    screenshot: stills.map(([n, w, h, a]) => ({ '@type': 'ImageObject', url: `${origin}${M}${n}.webp`, width: w, height: h, caption: a })),
  }),
  nodes: (origin) =>
    Object.entries(clips).map(([key, c]) => ({
      '@type': 'VideoObject',
      '@id': `${origin}/features#video-${key}`,
      name: c.name,
      description: c.text,
      thumbnailUrl: `${origin}${M}${key}-poster.webp`,
      contentUrl: `${origin}${M}${key}.mp4`,
      uploadDate: '2026-11-27',
      duration: `PT${c.s}S`,
      width: c.w,
      height: c.h,
      isFamilyFriendly: true,
      about: { '@id': `${origin}/#app` },
    })),
}
