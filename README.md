# pawbs

The source of **pawbs**, https://pawbs.app: a fast, private e621 and e926 viewer that runs in the
browser and installs as an app. Storage keys, file formats and a few internal names use the code's
older name, `nggallery`; they stay as they are so existing data, backups and transfers keep working.

A fast, installable viewer for image boards with a compatible JSON API (the `/posts.json`, `/tags.json`,
`/pools.json` family). Every request goes from the browser straight to the site you add, and everything you keep
(favourites, searches, follows, settings) stays in the browser (IndexedDB). The only server-side
part is optional: a small relay in the Docker image for moving that data to another device.

## Features

**Finding**
- Search field with autocomplete for tags (aliases, post counts, categories), filters (`order:`, `rating:`,
  `date:`…) and their values, pools by name, recent and saved searches.
- Query assistant (`Q`): a form over the search language. Tags (all of / any of / none of), tag-set
  combinations (`~( … )`, `-( … )`), rating, media type, sort, upload date (presets or a date range), score,
  favourites, size, shape, video length, file size, comments, uploader, favourited-by, pool, status,
  source, description and yes/no flags. The form and the search field edit the same query live; terms the
  form cannot express are kept and listed. It checks the query as you go: term limit, contradictions,
  duplicate sorts, lone `~`, malformed ranges, misspelled filters, and it keeps OR'd file types from
  merging with OR'd tags.
- "Refine" strip: tags that recur in the loaded results, to require (click) or exclude (Shift+click),
  counted locally.
- Popular by day, week or month; pools with covers, read in pool order; followed tags with new-post
  counts and a combined stream; history of viewed posts and searches.

- Trending today and rising tags on Home (blacklisted tags left out; Settings › Browsing turns them off).
- Similar pictures: the site's picture comparison for any post (details panel, right-click, or as a
  page): other versions, edits, higher resolutions, re-uploads, closest first.
- Artists: their links elsewhere (galleries, shops, social), other names and notes, under the artist
  tag in the details panel and above a search for one artist.
- Jump to a date: any search from a day back (a date picker or a week / month / years ago), as a
  `date:<=…` term that stays visible in the query and comes out with one click.
- Not interested: put a single post out of sight for good from its menu (with Undo); it leaves searches,
  feeds and the gallery, while favourites and collections keep it. Settings › Blacklist lists them to
  bring any back.

**Viewing**
- Grids in three layouts (justified rows, masonry columns, uniform squares), sized by a slider, laid out
  from known image sizes so nothing jumps. Infinite scroll; cursor paging for date-sorted searches.
- Full-height gallery: ← / → step through the list (more pages load on the way), **Numpad 0 / Numpad .**
  scrub videos (Shift for ×6, `,` / `.` step frames while paused), Space plays, `Z` zooms
  (fit → width → 1:1, drag to pan, double-click to zoom at a point), `I` details, `S` save, `D` download,
  `F` full screen, `N` notes, `Esc` back to the grid at the same place. Swipe on touch screens.
- Slideshow (`P` or the bar's button): a picture stays a few seconds (Settings › Gallery), a video plays
  to its end, more pages load on the way; Space or a tap pauses it, and the screen stays awake.
- Pools: where each one was left is remembered ("Continue · p. N", "read N/M" in the list), and a pool
  can be read as a long scroll, its pages one under the other, as well as in the grid and gallery.
- Selecting posts in any grid: Ctrl/Cmd-click, Shift-click for a run, or a post's menu › Select (long
  press on touch). A bar then favourites, unfavourites, adds to a collection or set, saves the files,
  hides ("not interested") or removes from the page's collection, set or history, all at once.
- Details panel: tags grouped by category with counts, wiki excerpts, add/exclude/follow/blacklist per
  tag, sources, pools, parent/children, description, comments, votes (with an account).

**Saving**
- Favourites stored locally per site, filterable, sortable, exportable; optional sync with the site
  account and import of the account's favourites.
- Downloads named by a pattern (`{id}-{artist}.{ext}`, …). When the file host allows reading its files
  from the page, single files save directly and many posts become a ZIP or go into a chosen folder; when
  it does not, the original opens in a new tab and many posts become a link list (plain or aria2 input
  with file names). Each host is tested once and remembered.

- Collections: named lists of posts kept in this browser, per site, made and filled without an account
  (from a post's menu, its details, a whole page or a selection), filtered and sorted like favourites,
  read in the gallery; included in backups and device transfers.
- Sets: browse public sets by name, keep any in a local set library (no account needed), read one in
  the gallery. With an account: your sets (private or public), make, edit and delete them, add a post
  from its menu or details (ticked when already in), add a whole page at once (a search, favourites, a
  pool, another set; a hundred per request), take posts out from the set's page.

**Speed**
- Smart preloading: while a post is shown, the next ones (and the previous one) are fetched and decoded
  ahead, the browsing direction gets the lead, the start of the next video is buffered, and hovered
  thumbnails warm their post. Data saver, slow connection types and slow measured load times scale it
  down. Modes: off, light, balanced, aggressive.
- Image quality picks the sample when it is sharp enough for the space it fills and the original when it
  is not; video picks the rendition closest to the window height.
- Request scheduler under the site's rate limit, with priorities (what you wait for first), merged
  duplicate requests and short-lived caching. Tag categories are cached across sessions.
- Lazy-loaded secondary views, off-screen rows skipped by the renderer, kept-alive pages so Back is
  instant and lands where you were.

**App**
- Installable PWA; the app shell is precached and opens offline. It updates itself when a new version
  is deployed. On Chromium, the installed app's icon shows how many new posts the followed tags have.
- Several sites, each with an optional account (user name + API key, sent only to that site in an
  Authorization header). Blacklist in the search language, hide or mask. Backup and restore of all data
  as JSON, optionally password-encrypted (PBKDF2 + AES-256-GCM).
- Transfer to another device (Settings › Data, or "From another device" on the first-run screen): the
  sending device shows a QR code for 5 minutes (and an 8-digit code when asked for one); the other one scans the QR code with
  the app's own scanner (or types the code) and receives everything, once. See "Device transfer relay".
- Full screen (Settings › Browsing, off by default, kept per device): the whole app without the system
  bar, for browsers that paint that bar in their own colour over an installed app whatever
  `theme-color` says (Chromium on Android tablets). It is entered at the first tap after each start;
  Back and Esc, which the browser uses to leave full screen, still go back and close.
- Block Flash (on by default, Settings › Browsing): searches add `-type:swf` so pages stay full; popular,
  pools, favourites and history drop Flash posts locally. A search that asks for `type:swf` still shows
  them.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check, then build into dist/
npm run preview    # serve dist/ (the service worker is active here)
npm run icons      # re-render the PNG icons from the SVG mark
```

Requires Node 20+. The toolchain is pinned to TypeScript 5.9 and vue-tsc 3.2.9: vue-tsc 3.3.x reports
false `.value` errors on stores used in narrowing template positions.

## Deploy

`dist/` is plain static files with relative paths and hash routing: put it on any static host
(GitHub Pages, Netlify, an S3 bucket, a folder on a web server). No rewrite rules are needed. Serve it over
HTTPS so the service worker and install work.

### Docker

The GitLab pipeline (`.gitlab-ci.yml`) builds a multi-arch image (linux/amd64, linux/arm64): Alpine's
nginx, running unprivileged on port 8080, serving the build with long caching for fingerprinted assets, no
caching for the entry points (so updates show at once), security headers (`deploy/headers.conf`) and a
`/healthz` endpoint used by the container health check. Text files are pre-compressed at build time
(`scripts/compress.mjs`: Brotli at maximum quality, gzip level 9) and served as they are, Brotli to
browsers that accept it. HTTP/2 and HTTP/3 come from whatever terminates TLS in front of the container
(a reverse proxy or CDN).

| Tag | Moves when |
| --- | --- |
| `latest` | a commit on the default branch passes the smoke test |
| `X.Y.Z` | the same commit: the version in `package.json` (pin this to stay on a release) |

```sh
docker build -t pawbs .
docker run -d --name pawbs -p 8080:8080 --restart unless-stopped pawbs
```

`deploy/docker-compose.yml` does the same with `docker compose up -d`. A private GitLab registry needs
a deploy token with the `read_registry` scope to pull from (`read_repository` is not enough). With the
snap package of Docker, do not add `no-new-privileges`: the container fails at start with
`exec /docker-entrypoint.sh: operation not permitted`. `npm run preview` serves the same headers as
the image, to test changes to `deploy/headers.conf` locally.

**Automatic updates:** store a redeploy webhook (for example a container manager's stack webhook,
with `pull_policy: always` in its compose) in the GitLab CI/CD variable `DEPLOY_WEBHOOK_URL` (masked).
The `deploy` job calls it once `latest` has moved, so each green pipeline on the default branch
redeploys with the new image. Without the variable the job is skipped.

For the service worker and "install app", browsers require HTTPS (or `localhost`): put the container
behind a reverse proxy with a certificate (Nginx Proxy Manager, Traefik, Caddy…). Over plain HTTP on a
LAN address the app still works, without offline start and install.

A link can pre-fill the first-run screen: `https://your.host/#/setup?site=<address>`.

### Device transfer relay

The image also runs a tiny relay for device transfers (`deploy/sync.js`, run by nginx's njs module;
`npm run dev` and `npm run preview` have an in-memory stand-in, `deploy/sync-dev.ts`). The sending
browser compresses the data and encrypts it with a random 256-bit key (AES-256-GCM); the relay holds only
that ciphertext, in memory, for 5 minutes, hands it out once and forgets it.

- **QR code:** a link to the app's receive page with the key after the `#`. Browsers never send that
  part to a server, so the relay cannot decrypt anything: end to end encrypted.
- **8-digit code** (for a device that cannot scan): one slow derivation of the code (PBKDF2-SHA256,
  600 000 iterations, split with HKDF) gives both the lookup the relay finds the transfer by and the key
  the transfer key is wrapped with. It is salted with the relay's value for the current 5-minute window
  (an HMAC of the window with a secret the relay makes at start), so nothing can be computed ahead.
  Guessing through the relay is hopeless: each transfer works once, for 5 minutes, and code attempts are
  capped at 10 a minute for the whole server (out of 100 000 000 codes). Whoever sees the requests (the
  relay, a proxy, a CDN terminating TLS) could still try every code offline, at 600 000 hashes each:
  many GPU-hours against a transfer that lives 5 minutes. The QR code has no such exposure.

Endpoints, all under `sync/v1/` next to the app: `health`, `salt`, `slots` (POST), `slots/<id>` (GET
once, DELETE by the sender), `slots/<id>/status`, `claim` (POST, by code). Requests another site makes
a browser send are refused (`Sec-Fetch-Site`), and bodies must be JSON. Limits: 12 MB per transfer,
96 MB held at once (when full, new transfers are refused rather than older ones dropped), request rates
capped per minute (for everyone together, and per visitor where a CDN in front names them). A static host without the relay simply hides the transfer option. The receiving
page needs camera access for scanning (`Permissions-Policy: camera=(self)`) and HTTPS.

Errors answer with a neutral page of the app's (JSON under `/sync/`), never nginx's own, and redirects
are relative (`absolute_redirect off`).

**Behind a CDN or proxy (recommended settings, outside this repository):** TLS 1.2 minimum, HSTS of a
year if it is preloaded, end-to-end encryption to the origin (Cloudflare: SSL "Full (strict)"), and
the container's port bound to the proxy only (for example `127.0.0.1:8080:8080`) so it cannot be
reached around the CDN.

## Notes

- The file host of a site may refuse requests without a `Referer` (often only for files its CDN has not
  cached, so failures look random). `index.html` sets `strict-origin-when-cross-origin`, which also
  overrides a host that sends `Referrer-Policy: no-referrer`. Do not change it to `no-referrer`.
- When a post has no sample, the API may put the original file (a `.swf` or video) in the sample fields and
  give a site-relative stand-in preview. The normalizer drops non-image URLs from image slots, makes
  relative URLs absolute against the site address, and treats such stand-ins as no preview.
- Storage is the browser's IndexedDB, read into memory at start-up; each change is on disk within a
  fraction of a second. Up to 1.6.0 it was localStorage, which browsers write to disk late (Firefox up to
  5 s after a change), so closing the app right after a change could lose it; 1.6.1 moves the data over on
  its first start. Where IndexedDB is unavailable, localStorage is still used (about 5 MB).
- Browsers set to delete site data when they close (LibreWolf by default) erase everything each time,
  unless the site is in their cookies and site data exceptions.

Typeface: Azeret Mono, SIL Open Font License (`public/OFL.txt`).
