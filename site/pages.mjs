/* The static pages of pawbs.app (features, install, FAQ…), turned into dist/<slug>.html after each build
   by scripts/site-pages.mjs, in the app's look. Plain HTML, no script: every crawler reads them whole.
   The slugs are also in site/slugs.json (nginx and the service worker leave these addresses to the
   server). Body HTML uses the classes of the page stylesheet in scripts/site-pages.mjs: `cards`/`card`,
   `steps`, `list`, `note`, `kbd`. Facts here must match the app: check the README when it changes.
   `updated` is the day a page's text last changed (its dateModified, and its lastmod in the sitemap):
   change it with the text, not with every build. `top: false` keeps a page out of the title bar's
   links (the footer lists every page). */

/** FAQ: shown on /faq and given to search engines as FAQPage data. Answers are HTML. */
export const faq = [
  {
    group: 'The basics',
    items: [
      ['What is pawbs?', 'pawbs is a free viewer for e621 and e926 that runs in your browser. It is a faster, cleaner way to search, browse, follow and save posts, on a phone as well as on a computer, and it installs like an app.'],
      ['What is e621?', 'e621 is a large furry art archive, a “booru”: pictures, animations and comics tagged by its community. It is an adult site, for people aged 18 and over. e926 is its safe-for-work version.'],
      ['Is pawbs an alternative front end for e621?', 'Yes. pawbs is a different interface over the same posts, tags, pools and accounts. It hosts and copies nothing: what you do with an account, such as favourites, votes and sets, happens on e621 itself.'],
      ['Is pawbs affiliated with e621?', 'No. pawbs is an independent, unofficial client. It talks to e621 and e926 through their public API, within their rate limits, and says who it is in every request.'],
      ['Is pawbs free? Are there ads?', 'pawbs is free, with no ads, no paid tier and no tracking.'],
      ['What is e926?', 'e926 is the safe-for-work version of e621: the same site and the same accounts, showing only posts rated safe. pawbs works with both; see <a href="/e926">pawbs for e926</a>.'],
    ],
  },
  {
    group: 'Accounts and privacy',
    items: [
      ['Do I need an e621 account?', 'No, you can browse as a guest. Sign in to see your e621 favourites and sets, vote, and bring your blacklist over.'],
      ['How do I sign in? Why an API key?', 'pawbs asks for your e621 user name and an API key, which you create in your e621 account settings, under API access. A key can do less than your password and you can revoke it at any time, so pawbs never needs your password.'],
      ['Where is my API key kept?', 'In this browser’s storage, on your device. It is sent only to e621 or e926, in the header of each request, never to pawbs.'],
      ['Does pawbs see what I browse?', 'No. Searches and pictures go straight from your browser to e621 or e926. The pawbs server only delivers the app itself and, when you use it, relays an end-to-end encrypted transfer between your devices. Read the <a href="/privacy">privacy page</a>.'],
    ],
  },
  {
    group: 'Using pawbs',
    items: [
      ['Does my e621 blacklist work?', 'Yes. When you sign in, your account’s blacklist is imported (if you have not written one in pawbs yet). You can edit it in Settings › Blacklist, in the same search language, and choose to hide or mask what it catches.'],
      ['Can I see my e621 favourites?', 'Yes, with an account. pawbs also keeps favourites of its own on your device, works without an account, and can sync them with your e621 favourites or import them.'],
      ['Can I download posts and whole pools?', 'Yes. Single posts open or save under a file name pattern you choose. For many posts at once, such as a pool, a search or a selection, pawbs makes a link list for your download manager (plain or aria2). e621’s file server does not let web pages read its files, so a ZIP straight from the page is not possible there. More on <a href="/downloads">downloads</a>.'],
      ['Can I read e621 comics and pools?', 'Yes. Comics on e621 are pools. pawbs reads a pool in order, as a grid, in the gallery or as one long scroll, and remembers where you left each one. See the <a href="/pools">pool reader</a>.'],
      ['Is there a slideshow?', 'Yes. Press P in the gallery: pictures stay a few seconds, videos play to the end, and the screen stays awake.'],
      ['Does it play videos?', 'Yes, WebM and MP4, in the rendition closest to your screen size, with scrubbing, frame stepping and an A-B loop. Flash posts are left out by default (Settings › Browsing).'],
      ['Does pawbs work offline?', 'The app itself starts without a connection. Posts and pictures need one, since they come from e621 or e926.'],
      ['Can I use several sites or accounts?', 'Yes. Add e621, e926 or another compatible board, each with its own account if you want, and switch between them from the title bar.'],
      ['Does it work with other boorus?', 'pawbs works with boards that offer the same API as e621 (the /posts.json family). Enter the board’s address on the first screen and pawbs checks it.'],
    ],
  },
  {
    group: 'Devices',
    items: [
      ['Is there an e621 app for iPhone or Android?', 'pawbs is one, as a progressive web app (PWA): open pawbs.app and add it to your home screen, and it runs like an installed app, with no app store needed. See <a href="/install">how to install pawbs</a>.'],
      ['How do I move my data to another device?', 'In Settings › Data, choose Send to another device: it shows a QR code for 5 minutes, and an 8-digit code if the other device cannot scan. On the other device, scan it from Settings › Data › Receive, or with From another device on its first screen. You can also save an encrypted backup file and restore it.'],
      ['How do I report a bug or suggest something?', 'Write to <a href="mailto:contact@pawbs.app">contact@pawbs.app</a>.'],
    ],
  },
]

const kbd = (k) => `<kbd>${k}</kbd>`

export const pages = [
  {
    slug: 'features',
    nav: 'Features',
    title: 'pawbs features: e621 search, pools, slideshow, downloads',
    description: 'Everything pawbs does as an e621 and e926 viewer: tag autocomplete, a query assistant, followed tags and searches, a pool reader, sets, slideshow, video A-B loop, downloads.',
    updated: '2026-11-24',
    crumb: 'Features',
    h1: 'A faster way to browse e621',
    lede: 'pawbs puts e621 and e926 in a fast, clean interface made for long sessions, on a phone as well as on a computer. Here is what it does.',
    body: `
<h2>Search</h2>
<div class="cards">
  <div class="card"><h3>Autocomplete</h3><p>Tags with their aliases, post counts and categories, filters such as <code>order:</code>, <code>rating:</code> or <code>date:</code> and their values, pools by name, and your recent and saved&nbsp;searches.</p></div>
  <div class="card"><h3>Query assistant</h3><p>Press ${kbd('Q')} for a form over e621’s search language: all of, any of and none of, rating, media type, sort, dates, score, size, video length and more. It checks the query as you write it.</p></div>
  <div class="card"><h3>Refine</h3><p>The tags that recur in what you are looking at, one click to require them and Shift+click to exclude them.</p></div>
  <div class="card"><h3>Trending and rising</h3><p>The tags searched most today and the ones gaining posts fast, on Home, without the ones your blacklist hides.</p></div>
  <div class="card"><h3>Jump to a date</h3><p>Any search from a day back, a week, a month or years ago, as a term you can see and remove in one click.</p></div>
  <div class="card"><h3>Similar pictures</h3><p>Other versions, edits, higher resolutions and re-uploads of any post, closest first, and the artist’s galleries and links elsewhere.</p></div>
</div>

<p><a href="/search">More about search in pawbs</a></p>

<h2>Browse and view</h2>
<ul class="list">
  <li>Three grid layouts (justified rows, masonry columns, squares), sized with a slider and laid out from known image sizes, so nothing jumps while it loads. Infinite scroll.</li>
  <li>A full-screen gallery: ${kbd('←')} ${kbd('→')} step through the list, ${kbd('Z')} zooms (fit, width, 1:1, drag to pan), ${kbd('I')} shows details, ${kbd('F')} full screen, ${kbd('N')} notes, ${kbd('Esc')} returns to the grid where you were. Swipe on touch screens.</li>
  <li>Slideshow (${kbd('P')}): pictures stay a few seconds, videos play to the end, and the screen stays awake.</li>
  <li>Videos in the rendition closest to your screen, with scrubbing, frame steps and an A-B loop.</li>
  <li>Details: tags by category with counts, wiki excerpts, sources, pools, parent and child posts, description, comments and votes.</li>
  <li>Popular posts by day, week or month, and a history of what you viewed and searched.</li>
</ul>

<h2>Follow and read</h2>
<div class="cards">
  <div class="card"><h3>Following</h3><p>Follow a tag, an artist or a whole search and see how many new posts each got since you last looked, marked as new in its results, or read them all as one stream. Saved pools show their new pages in the same list.</p></div>
  <div class="card"><h3>Pools</h3><p>Read pools in order, as a grid, in the gallery or as one long scroll. pawbs remembers where you left each one. <a href="/pools">The&nbsp;pool&nbsp;reader</a></p></div>
  <div class="card"><h3>Sets</h3><p>Browse public sets and keep them in a library, no account needed. With an account, make and edit your own.</p></div>
</div>

<h2>Keep and save</h2>
<ul class="list">
  <li>Favourites on your device, filtered and sorted, optionally synced with your e621 favourites.</li>
  <li>Collections: your own named lists of posts, made without an account.</li>
  <li>Select many posts at once (Ctrl or Shift click, or a long press) to favourite them, add them to a collection or set, save them or hide them together.</li>
  <li>Downloads named by a pattern such as <code>{id}-{artist}.{ext}</code>. Many posts at once become a link list for your download manager (plain or aria2). <a href="/downloads">About&nbsp;downloads</a></li>
  <li>“Not interested”: put a single post out of sight for good, with Undo.</li>
</ul>

<h2>Fast by design</h2>
<ul class="list">
  <li>The next posts load and decode before you get there, in the direction you are browsing; slow connections and data saver scale it down.</li>
  <li>Pictures in the sharpest size the space needs, not more.</li>
  <li>Requests are scheduled under the site’s rate limit, with what you wait for first.</li>
  <li>Back is instant and lands exactly where you were.</li>
</ul>

<h2>Private and yours</h2>
<ul class="list">
  <li>No ads, no tracking, no account of its own. Requests go straight from your browser to e621 or e926.</li>
  <li>A blacklist in the search language, imported from your e621 account, to hide or mask posts.</li>
  <li>Several sites, each with its own account.</li>
  <li>Backups of everything, optionally encrypted with a password, and an end-to-end encrypted transfer to another device with a QR code.</li>
</ul>

<h2>An app, without the store</h2>
<ul class="list">
  <li>Installs on iPhone, iPad, Android, Windows, macOS, Linux and ChromeOS. <a href="/install">How&nbsp;to&nbsp;install</a></li>
  <li>Starts offline and updates itself.</li>
  <li>On Chrome and Edge, the app’s icon shows how many new posts and pages what you follow has.</li>
  <li>A full-screen mode for tablets whose browser paints its own bar over the app.</li>
</ul>`,
  },
  {
    slug: 'pools',
    nav: 'Pools',
    title: 'e621 pool reader: read comics and pools in order · pawbs',
    description: 'Read e621 comics and pools in order with pawbs: as a grid, in a full-screen gallery or as one long scroll. It remembers the page where you left each one.',
    published: '2026-11-23',
    updated: '2026-11-23',
    top: false,
    crumb: 'Pool reader',
    h1: 'An e621 pool reader for comics and series',
    lede: 'On e621, comics and series are kept in pools. pawbs shows a pool’s pages in pool order, lets you read them three ways and remembers where you stopped.',
    body: `
<h2>Find a pool</h2>
<ul class="list">
  <li>The Pools page searches the site’s pools by name, with their covers. Show series only or collections only.</li>
  <li>In the search field, type <code>pool:</code> and the start of a name: pawbs suggests the pools that match.</li>
  <li>A post that belongs to a pool lists it in its details.</li>
</ul>

<h2>Three ways to read</h2>
<div class="cards">
  <div class="card"><h3>Grid</h3><p>Every page as a thumbnail, in pool order. Good for finding a chapter or a scene.</p></div>
  <div class="card"><h3>Gallery</h3><p>Press <b>Read</b> for one page at a time, full height. ${kbd('←')} and ${kbd('→')} turn the pages, ${kbd('Z')} zooms,. Swipe to turn the pages on touch screens.</p></div>
  <div class="card"><h3>One long scroll</h3><p>Switch the reading mode to <b>Scroll</b> and the pages come one under the other, to read without turning anything.</p></div>
</div>

<h2>Pick up where you left off</h2>
<p>pawbs notes the last page you looked at in each pool. Open the pool again and a <b>Continue</b> button takes you to that page, while the list of pools shows how far you read, such as “read 12/40”. This is kept in your browser, with no account needed.</p>
<p>Save a pool to your library with the bookmark button and it stays one tap away. When a saved pool gets new pages, the library shows how many were added since you last opened it, and can put those pools first.</p>

<h2>Save a whole pool</h2>
<p>The download button on a pool saves the pages loaded on screen, named by the pattern you chose. On e621 that means a link list for your download manager: see <a href="/downloads">downloads</a> for why. The same pages can also go into a collection of your own.</p>

<h2>On e926 too</h2>
<p>Pools work the same way on <a href="/e926">e926</a>, the safe-for-work side of e621. Choose e926 on the first screen of <a href="/">pawbs.app</a>.</p>

<p class="note">pawbs is free and needs no account to read pools. <a href="/features">All&nbsp;features</a></p>`,
  },
  {
    slug: 'downloads',
    nav: 'Downloads',
    title: 'e621 downloader: save posts and whole pools · pawbs',
    description: 'Download e621 posts with pawbs: one file at a time under a name pattern you choose, or a pool, a search or a selection as a link list for a download manager.',
    published: '2026-11-23',
    updated: '2026-11-23',
    top: false,
    crumb: 'Downloads',
    h1: 'Download e621 posts, pools and searches',
    lede: 'pawbs saves one post under a file name you design, and turns many posts into a list your download manager can fetch. Here is how it works, and what a web page cannot do.',
    body: `
<h2>One post</h2>
<p>In the gallery, press ${kbd('D')} to download the post you are looking at. Where the file host lets pawbs read the file, it is saved straight away under your file name. On e621 the original opens in a new tab instead, and you save it from there.</p>

<h2>File names</h2>
<p>Settings › Saving holds the file name pattern, <code>{id}-{artist}.{ext}</code> to begin with. Build your own from these tokens:</p>
<ul class="list">
  <li><code>{id}</code>, <code>{md5}</code> and <code>{ext}</code>: the post number, the file’s hash and its extension.</li>
  <li><code>{artist}</code>, <code>{character}</code>, <code>{species}</code> and <code>{copyright}</code>: up to three tags of that kind, joined with <code>+</code>.</li>
  <li><code>{tags}</code>: the first five general tags.</li>
  <li><code>{rating}</code>, <code>{date}</code>, <code>{width}</code>, <code>{height}</code> and <code>{score}</code>.</li>
</ul>
<p>Characters a file name cannot hold are replaced.</p>

<h2>Many at once</h2>
<p>A search, a pool, your favourites, a collection, a set or a selection of posts each have a download button. It counts the posts loaded on the page, estimates their total size and offers two lists:</p>
<ul class="list">
  <li><b>Links</b>: a plain text file, one file address per line.</li>
  <li><b>aria2 list</b>: each address with its file name, so <code>aria2c -i</code> fetches every post under the name from your pattern.</li>
</ul>

<h2>Why a link list and not a ZIP</h2>
<p>Browsers only let a page read files from a host that allows it, and e621’s file server does not. So a ZIP straight from the page is not possible there, and a download manager does the fetching. pawbs tests each file host once and remembers the answer: on a compatible board whose host does allow it, the same dialog offers a ZIP, or a folder you pick in browsers that support it.</p>

<h2>Within the rules</h2>
<p>pawbs schedules its own requests under the site’s rate limit, and it fetches no files to write a link list. Keep your download manager just as polite.</p>

<p class="note">Reading a comic first? See the <a href="/pools">pool reader</a>.</p>`,
  },
  {
    slug: 'search',
    nav: 'Search',
    title: 'e621 search: tag autocomplete and a query assistant · pawbs',
    description: 'Search e621 with pawbs: tag autocomplete with aliases and post counts, a query assistant that writes the search syntax for you, followed searches and more.',
    published: '2026-11-23',
    updated: '2026-11-24',
    top: false,
    crumb: 'Search',
    h1: 'e621 search without the manual',
    lede: 'e621 has a powerful search language, and a long page of rules to learn it. pawbs suggests the words as you type and gives you a form that writes the rest.',
    body: `
<h2>Autocomplete</h2>
<p>The search field completes the word under the caret: tags with their aliases, post counts and categories, filters and their values, and pools by name after <code>pool:</code>. A leading <code>-</code> or <code>~</code> is kept. When the field is empty, it offers your saved and recent searches.</p>
<ul class="list">
  <li><code>fox -comic</code>: foxes, without comics.</li>
  <li><code>~cat ~dog</code>: cats or dogs.</li>
  <li><code>rating:s</code>: posts rated safe only.</li>
  <li><code>date:week order:score</code>: the best of this week.</li>
</ul>

<h2>Query assistant</h2>
<p>Press ${kbd('Q')} for a form over the same language: tags to require, tags of which one is enough, tags to leave out, then rating, media type, sort, upload date, score, favourites, size, shape, video length, file size and more. The form and the search field edit the same query, so you can switch between them at any time. The assistant also checks the query as you write it, for contradictions, a sort given twice, a lone <code>~</code>, a malformed range or a misspelled filter.</p>

<h2>Refine what you see</h2>
<p>Above the results, pawbs lists the tags that recur in the posts already loaded. Click one to require it, Shift+click to exclude it.</p>

<h2>Followed searches and history</h2>
<p>The Follow button on a results page follows the whole search: Home and Following then show how many new posts it got since you last looked, and its results mark them as new. Recent searches come back in the search field, and History keeps the searches you ran.</p>

<h2>Jump to a date</h2>
<p>See any search as it was a week, a month, six months or years ago, or pick a day. The date joins the query as a <code>date:&lt;=</code> term that you can see and remove.</p>

<h2>Trending and rising tags</h2>
<p>Home shows the tags searched most today and the tags that are rising, without the ones your blacklist names. Settings › Browsing turns them off.</p>

<p class="note">The same search works on <a href="/e926">e926</a>. <a href="/features">All&nbsp;features</a></p>`,
  },
  {
    slug: 'install',
    nav: 'Install',
    title: 'Install pawbs, the e621 app for iPhone, Android and PC',
    description: 'Install pawbs, a free e621 and e926 app (PWA), on iPhone, iPad, Android, Windows, macOS, Linux or ChromeOS in three steps. No app store, no sideloading.',
    updated: '2026-11-24',
    crumb: 'Install',
    h1: 'Install pawbs, the e621 app, on any device',
    lede: 'pawbs is a progressive web app (PWA): you add it from the browser in a few taps, with no app store and no sideloading. Once installed, it opens in its own window, starts offline and updates itself.',
    body: `
<h2>iPhone and iPad</h2>
<ol class="steps">
  <li>Open <a href="/">pawbs.app</a> in <b>Safari</b>.</li>
  <li>Tap the <b>Share</b> button.</li>
  <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
</ol>
<p class="note">pawbs then opens from its icon, full screen, like any other app.</p>

<h2>Android</h2>
<ol class="steps">
  <li>Open <a href="/">pawbs.app</a> in <b>Chrome</b>.</li>
  <li>Open the <b>⋮</b> menu and choose <b>Install app</b> (or <b>Add to Home screen</b>).</li>
  <li>Confirm. pawbs appears with your other apps.</li>
</ol>
<p class="note">Firefox, Samsung Internet and most other browsers have the same option in their menu. Home also shows an Install app button where the browser offers it.</p>

<h2>Windows, macOS, Linux and ChromeOS</h2>
<ol class="steps">
  <li>Open <a href="/">pawbs.app</a> in <b>Chrome</b> or <b>Edge</b>.</li>
  <li>Click the <b>install</b> icon at the right end of the address bar.</li>
  <li>Confirm. pawbs gets its own window, icon and taskbar or Dock entry.</li>
</ol>
<p class="note">In Safari on a Mac, use <b>File › Add to Dock</b>. Firefox on a computer cannot install web apps; pawbs works there in a normal tab.</p>

<h2>First start</h2>
<ol class="steps">
  <li>Choose <b>e621</b> or <b>e926</b>, or <b>Custom</b> to type the address of another compatible board.</li>
  <li>Optionally, turn on <b>Use an account</b> and enter your e621 user name and API key, to see your favourites and sets.</li>
  <li>Tap <b>Browse</b>. For e621, confirm that you are 18 or older (asked once on each device). That’s it.</li>
</ol>
<p class="note">Already using pawbs on another device? Choose <b>From another device</b> on the first screen, and send everything over with a QR code from the other device’s Settings › Data.</p>`,
  },
  {
    slug: 'faq',
    nav: 'FAQ',
    title: 'pawbs FAQ: e621 account, API key, blacklist, downloads',
    description: 'Answers about pawbs, the free e621 and e926 viewer: do you need an account, why an API key, privacy, blacklist, downloads, videos, iPhone and Android.',
    updated: '2026-11-23',
    crumb: 'FAQ',
    h1: 'Questions about pawbs',
    lede: 'Accounts, privacy, downloads, devices: the questions people ask about pawbs, answered.',
    faq: true,
  },
  {
    slug: 'e926',
    nav: 'e926',
    title: 'e926 viewer: fast, safe-for-work e621 browsing · pawbs',
    description: 'pawbs is a free e926 viewer and app: the safe-for-work version of e621 with the same fast search, followed tags, pools and favourites. No account needed.',
    updated: '2026-11-24',
    crumb: 'e926',
    h1: 'pawbs for e926: a fast e926 viewer',
    lede: 'e926 is the safe-for-work side of e621: the same site, the same tags and the same accounts, showing only posts rated safe. pawbs works with it just as it does with e621.',
    body: `
<h2>What e926 is</h2>
<p>e926.net is the same archive as e621.net with one filter always on: only posts rated safe are shown. Tags, pools, sets and accounts are shared, so a search, a followed tag or a favourite means the same thing on both.</p>

<h2>An e926 app for phone and computer</h2>
<p>pawbs is a free e926 viewer that installs like an app on iPhone, iPad, Android and computers, with no app store. <a href="/install">How to install pawbs</a></p>

<h2>Use pawbs with e926</h2>
<ol class="steps">
  <li>Open <a href="/">pawbs.app</a>.</li>
  <li>Choose <b>e926</b> on the first screen.</li>
  <li>Tap <b>Browse</b>. Your e621 account works on e926 too, if you want to sign in.</li>
</ol>

<h2>Everything works the same</h2>
<ul class="list">
  <li>Tag search with autocomplete and the query assistant.</li>
  <li>Followed tags and searches with new-post counts, pools read in order, sets and popular posts.</li>
  <li>Favourites, collections, the blacklist and downloads.</li>
  <li>The gallery, slideshow and video controls. <a href="/features">All&nbsp;features</a></li>
</ul>

<h2>e621 and e926 side by side</h2>
<p>Add both sites and switch between them from the title bar: they share your favourites, follows, collections and history (on e926, what is not rated safe stays out of sight), and the e926 one stays safe for work. You can also stay on e621 and add <code>rating:s</code> to a search to see safe posts only.</p>

<p class="note">e926 shows posts its community rated safe. Ratings are given by people, so pawbs cannot promise that nothing slips through.</p>`,
  },
  {
    slug: 'about',
    nav: 'About',
    title: 'About pawbs, an independent e621 client and front end',
    description: 'pawbs is an independent, free e621 and e926 client in your browser: an alternative front end made to be fast and private. Why it exists and how it works.',
    updated: '2026-11-23',
    crumb: 'About',
    h1: 'About pawbs',
    lede: 'pawbs is an independent viewer for e621 and e926, made to be fast, clean and private, on every device.',
    body: `
<h2>Why pawbs</h2>
<p>Browsing e621 on a phone, or for hours on a computer, should be quick and pleasant. pawbs loads what you are about to see before you get there, keeps your place everywhere, and puts e621’s powerful search language within reach of anyone, with autocomplete and a query assistant. It works the same on a phone, a tablet and a computer. <a href="/features">Everything pawbs does</a></p>
<p>pawbs is an alternative front end for e621: a different interface over the same posts, tags, pools and accounts. It hosts nothing itself.</p>

<h2>How it works</h2>
<ul class="list">
  <li>pawbs is a web app. Your browser downloads it from pawbs.app once, then it runs on your device, even offline.</li>
  <li>Searches and pictures go straight from your browser to e621 or e926, through their public API. pawbs respects their rate limits and names itself in every request, with a contact address.</li>
  <li>What you keep (favourites, follows, collections, settings) stays in your browser. There are no pawbs accounts.</li>
  <li>The pawbs server only delivers the app and, when you ask for it, relays an end-to-end encrypted transfer between your own devices. <a href="/privacy">Privacy in detail</a></li>
</ul>

<h2>Independent</h2>
<p>pawbs is not affiliated with, endorsed by or connected to e621 or e926. Their names are used only to say what pawbs works with.</p>

<h2>Contact</h2>
<p>Questions, bugs, ideas: <a href="mailto:contact@pawbs.app">contact@pawbs.app</a>. Security reports are welcome at the same address (<a href="/.well-known/security.txt">security.txt</a>).</p>

<p class="note">Typeface: Azeret Mono, under the SIL Open Font License.</p>`,
  },
  {
    slug: 'privacy',
    nav: 'Privacy',
    title: 'Privacy: pawbs is a private e621 client with no tracking',
    description: 'How pawbs, a private e621 and e926 client, handles your data: no tracking, no ads, no accounts. What stays in your browser and what the server sees.',
    updated: '2026-11-23',
    crumb: 'Privacy',
    h1: 'Privacy',
    lede: 'pawbs has no ads, no analytics, no tracking and no accounts. Here is exactly where your data goes.',
    body: `
<h2>In short</h2>
<ul class="list">
  <li>What you keep in pawbs stays in your browser, on your device.</li>
  <li>Searches and pictures go straight to e621 or e926, not through pawbs.</li>
  <li>pawbs sets no cookies of its own and uses no analytics or tracking of any kind.</li>
</ul>

<h2>On your device</h2>
<p>Your sites, favourites, collections, follows, searches, history, blacklist and settings are stored in your browser’s storage. So is your API key if you sign in. Clearing the site’s data in your browser, or Settings › Data › Erase everything, removes all of it. pawbs cannot see or recover it.</p>

<h2>e621 and e926</h2>
<p>When you browse, your browser talks to e621 or e926 directly, as it does on their own website: they see your IP address and what you request, and your API key when you sign in. Their own privacy policy applies to that.</p>

<h2>The pawbs server</h2>
<p>The server delivers the app’s files. Like any web server, it sees the IP address and the files requested, and it records no searches, posts or favourites, since those never reach it. pawbs.app is served through Cloudflare, which processes these requests to deliver and protect the site and may set a short-lived security cookie when it checks a visitor.</p>
<p>When you move your data to another device, the data is encrypted on your device before it leaves, and only the device that receives it can decrypt it. The server holds it in memory for at most 5 minutes and deletes it as soon as it is received, or when the transfer is cancelled or expires.</p>

<h2>Contact</h2>
<p>Questions about your data: <a href="mailto:contact@pawbs.app">contact@pawbs.app</a>. More answers in the <a href="/faq">FAQ</a>, and who is behind pawbs on the <a href="/about">about page</a>.</p>`,
  },
]
