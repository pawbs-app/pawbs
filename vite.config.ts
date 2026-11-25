import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import pkg from './package.json' with { type: 'json' }
import siteSlugs from './site/slugs.json' with { type: 'json' }
import { devSyncRelay } from './deploy/sync-dev'

/** The production response headers (deploy/headers.conf, used by nginx), so `vite preview` matches. */
function productionHeaders(): Record<string, string> {
  try {
    const conf = readFileSync(new URL('./deploy/headers.conf', import.meta.url), 'utf8')
    return Object.fromEntries([...conf.matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"/gm)].map((m) => [m[1], m[2]]))
  } catch {
    return {}
  }
}

/* The static pages (site/pages.mjs, written into dist/ by scripts/site-pages.mjs): /faq serves
   faq.html. nginx does it with try_files; this does it for `npm run preview`. The service worker
   leaves these addresses to the network (navigateFallbackDenylist below), or an installed app would
   answer them with itself. */
const sitePage = new RegExp(`^/(${siteSlugs.join('|')})(\\.html|/)?(\\?.*)?$`)
function sitePagesPreview(): Plugin {
  return {
    name: 'site-pages-preview',
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = req.url?.match(/^\/([a-z0-9-]+)(\?.*)?$/)
        if (m && siteSlugs.includes(m[1])) req.url = `/${m[1]}.html${m[2] ?? ''}`
        next()
      })
    },
  }
}

// Relative base so the build can be served from any folder of any static host.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  preview: {
    headers: productionHeaders(),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // One stylesheet: the first screen otherwise waited on about ten small ones, each blocking the
    // first paint (Lighthouse "render-blocking requests"). All of it is ~15 KB compressed.
    cssCodeSplit: false,
    sourcemap: false,
  },
  plugins: [
    vue(),
    // index.html's structured data: the version and the day of the build.
    {
      name: 'html-version',
      transformIndexHtml: (html: string) =>
        html.replaceAll('{{APP_VERSION}}', pkg.version).replaceAll('{{BUILD_DATE}}', new Date().toISOString().slice(0, 10)),
    },
    // The device transfer relay for local runs (nginx runs deploy/sync.js in production).
    devSyncRelay(),
    sitePagesPreview(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/paw.svg', 'icons/paw-180.png', 'favicon.ico'],
      manifest: {
        id: './',
        // The public name (the project itself is NgGallery).
        name: 'pawbs',
        short_name: 'pawbs',
        description: 'Fast, private viewer for e621 and e926: tag search, pools, followed tags, favourites. Installable, opens offline, no tracking or ads.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        // Near-black rather than #000000 (1/255 apart: the system bars still look black). Some
        // Android browsers treat a pure black theme colour as unset and fall back to a grey bar.
        background_color: '#010101',
        theme_color: '#010101',
        categories: ['entertainment', 'photo'],
        icons: [
          // icons/: renamed whenever the icon changes (see scripts/make-icons.mjs).
          { src: 'icons/paw-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/paw-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/paw-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/paw.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        // Long-press menu of the installed app (Android, Windows, ChromeOS).
        shortcuts: [
          { name: 'Search', url: './#/posts', description: 'Latest posts and tag search' },
          { name: 'Popular', url: './#/popular', description: 'Popular posts today' },
          { name: 'Favourites', url: './#/favorites', description: 'Your favourites' },
          { name: 'Following', url: './#/following', description: 'New posts in the tags you follow' },
        ],
      },
      workbox: {
        // The app shell is precached; everything from the site's API and file host stays live.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,txt}'],
        // The link preview picture is for other sites (social networks, chat apps), not the app.
        globIgnores: ['**/og-image.png'],
        navigateFallback: 'index.html',
        // The relay's addresses and the check page (deploy/check/) are the server's, never the app's:
        // opened in the browser (to pass the CDN's check), they must reach the network. Workbox matches
        // these against the path and the query: an address with "/sync/" in its query passes too.
        navigateFallbackDenylist: [/\/sync\//, /^[^?]*\/check($|\?)/, sitePage],
        cleanupOutdatedCaches: true,
        // A new version activates at once and takes over open pages, which then reload on it.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
})
