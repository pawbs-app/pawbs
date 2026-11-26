# pawbs: technical notes

How pawbs is built, deployed and kept private, for contributors and self-hosters. The overview is in
the [README](../README.md).

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check, then build into dist/
npm run preview    # serve dist/ (the service worker is active here)
npm run icons      # re-render the PNG icons from the SVG mark
```

Requires Node 22.12+; the image and CI build on Node 26. The toolchain is pinned to TypeScript 6.0 and
vue-tsc 3.2.9: vue-tsc 3.3.x reports false `.value` errors on stores used in narrowing template
positions, and TypeScript 7 waits for a vue-tsc that supports it.

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
| `beta` | a commit on the `beta` branch passes the smoke test (what beta.pawbs.app runs) |

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

**Channels:** changes land on the `beta` branch first. Each green pipeline there tags the image `beta`
and calls `DEPLOY_BETA_WEBHOOK_URL` (the `deploy-beta` job), which redeploys beta.pawbs.app. A release
is the default branch fast-forwarded to `beta`: that commit's image is already built and tested, so the
pipeline releases it as it is (no rebuild) and the main site runs exactly what beta ran. A commit
pushed straight to the default branch (a fix that cannot wait) is built as usual; `beta` then merges
the default branch back in, so the next release is still a fast-forward. Served at an address starting
with `beta.`, the same image adds `X-Robots-Tag: noindex, nofollow` (`deploy/nginx.conf`) and the app
shows a beta mark; Settings › About shows the build's commit on both.

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
