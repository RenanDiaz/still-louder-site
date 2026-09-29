# Main site: PWA and service worker

Reference for the main site's service worker, web app manifest and offline page,
written from the code. Remaining gaps are listed under **Known issues**.

## Files

| File (source) | Role | In `dist/` after `npm run build` |
|---|---|---|
| `public/assets/sw.js` | Service worker: precache, runtime caching, offline fallback, message API | `/sw.js` (verbatim) |
| `public/assets/js/sw-register.js` | Registers the SW, shows the update banner and install prompt, and emits the analytics events. Self-contained IIFE, loaded as `<script type="module">` | Bundled with a hash into `/assets/js/` |
| `public/assets/offline.html` | Offline fallback page (inline CSS/JS, retry button, auto-reloads when back online) | `/offline.html` (verbatim; both hosts serve it at `/offline` too) |
| `public/assets/site.webmanifest` | Web app manifest | `/site.webmanifest` (verbatim, unhashed) |
| `public/index.html`, `public/al-vacio-pre-release.html` | Link the manifest (`<link rel="manifest" href="/site.webmanifest">`) and load `sw-register.js` with `<script type="module" src="/assets/js/sw-register.js">` | Built entries |
| `public/assets/js/main.js` | `initPWAShortcuts()` handles `?action=` from manifest shortcuts | Bundled |
| `vite.config.js` | `root: 'public'`, `publicDir: 'assets'`, inputs are only `index.html` and `al-vacio-pre-release.html` | — |
| `vercel.json`, `public/assets/_headers` | `Cache-Control: no-cache` for `/sw.js` in both | — |

Vite reminder: files in `public/assets/` (the publicDir) are copied **to the
root of `dist/`** with no `assets/` prefix, while files Vite processes from HTML
land in hashed `dist/assets/<type>/` paths. So `sw.js`, `offline.html` and the
manifest must reference other publicDir files by their root path
(`/favicon-96x96.png`), and the manifest is linked by its publicDir URL
(`/site.webmanifest`) so it keeps a stable, precacheable URL.

## Service worker (`public/assets/sw.js`)


### Cache names and versioning

```js
const CACHE_VERSION   = 'still-louder-v1.4.0';
const OFFLINE_VERSION = 'still-louder-offline-v1.3.0';
```

| Cache | Name | Contents |
|---|---|---|
| Precache | `${CACHE_VERSION}-precache` | `PRECACHE_URLS`, fetched with `cache: 'no-cache'` at install |
| Runtime | `${CACHE_VERSION}-runtime` | CSS/JS (stale-while-revalidate), fonts, HTML and everything else (network-first) |
| Images | `${CACHE_VERSION}-images` | Images (cache-first) |
| Offline | `OFFLINE_VERSION` | `/offline.html` only (stored as a non-redirected copy, see below) |

On `activate`, every cache whose name is not one of those four is deleted, then
`clients.claim()` runs. `install` finishes with `self.skipWaiting()`, so a new SW
activates as soon as it installs and does not wait for tabs to close.

**Rule: bump `CACHE_VERSION` whenever you ship HTML/CSS/JS changes.** Why:

- The browser only installs a new SW when the bytes of `sw.js` change. Without
  a new version string, old runtime entries stay in place indefinitely.
- CSS/JS is served **stale-while-revalidate**, and HTML is **network-first**. A
  returning visitor gets the new HTML with the *cached old* CSS/JS for one load.
  Hashed Vite bundles are safe because their URLs change, but unhashed files
  (everything copied from `public/assets/`, like `sw-register.js`, the
  pre-release page's CSS/JS, `variables.css`) are not. The comment at the top
  of `sw.js` records one case: an unstyled show card with no countdown.
- The new version renames all three versioned caches, and `activate` deletes the old ones.

`OFFLINE_VERSION` does not need bumping for content changes, because every
install re-adds `/offline.html` to that cache.

### Strategies by request (in `fetch` handler order)

| Match | Strategy |
|---|---|
| Non-GET, `chrome-extension:`/`moz-extension:` | Not intercepted |
| Host `www.google-analytics.com` / `www.googletagmanager.com`, or path contains `/gtag/` | Network only. On failure it returns an empty `Response` |
| `destination === 'image'` or path ends in jpg/jpeg/png/gif/svg/webp/avif/ico | Cache first → images cache. On a network failure for an image it returns an inline "Offline" SVG placeholder |
| `destination === 'font'` or host `fonts.gstatic.com` | Cache first → runtime cache |
| `destination` `style` or `script` | Stale-while-revalidate → runtime cache |
| `destination === 'document'` or `Accept` includes `text/html` | Network first → runtime cache. Falls back to cache, then to `/offline.html` for navigations, then to a 503 text response |
| `destination === 'audio'` or path contains `.mp3` | Network only. Offline it returns a 503 "Audio not available offline" (audio is never cached) |
| Anything else (JSON, manifest, …) | Network first, same as HTML |

Only `response.ok` responses are written to cache. The caches have no size or
age limits.

### Precache list (`PRECACHE_URLS`)

`/`, `/site.webmanifest`, `/favicon-96x96.png`, `/favicon.svg`,
`/apple-touch-icon.png`, `/web-app-manifest-192x192.png`,
`/web-app-manifest-512x512.png`, and the Google Fonts CSS with **exactly** the
URL `index.html` loads (`Inter:wght@400;500;600;700&family=Bebas+Neue`).

Only URLs that exist **unhashed** in `dist/` belong here. Hashed CSS/JS bundles
change name on every build, so the runtime cache picks them up instead. Clean-URL
pages (`/index.html`, `/al-vacio-pre-release.html`) are left out on purpose: both
hosts redirect them, and a redirected response cannot answer a navigation.

`cache.addAll()` is all-or-nothing. If **any** URL fails (404, network error,
CSP block), the install promise rejects, the SW never activates, and the browser
tries again on the next update check. After touching this list, run
`npm run build` and confirm every entry exists in `dist/`.

`/offline.html` is cached separately by `cacheOfflinePage()`. Vercel
(`cleanUrls`) and Cloudflare (`html_handling`) answer it with a redirect to
`/offline`; the SW follows it and stores the body as a fresh `Response`, because
a redirected response served to a navigation request makes the browser fail the
navigation.

### Message API

| `postMessage({ type })` | Effect |
|---|---|
| `SKIP_WAITING` | `self.skipWaiting()` (sent by the update banner's "Actualizar" button) |
| `CLEAR_CACHE` | Deletes **all** caches, including the offline cache |
| `GET_VERSION` | Replies `{ version: CACHE_VERSION }` on `event.ports[0]` (requires a `MessageChannel`) |

`sync` (`sync-analytics`) and `push`/`notificationclick` handlers exist but are
placeholders. Nothing registers a sync, and notifications are disabled
(`enableNotifications: false` in `sw-register.js`).

## Registration, updates and install prompt (`sw-register.js`)

An IIFE runs on `DOMContentLoaded` (or right away if the DOM is already parsed). Its config is:
`swPath: '/sw.js'`, `updateCheckInterval: 60000`, `installPromptDelay: 3000`,
`enableNotifications: false`, `debug: true`.

- **Registration**: `navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })`.
  If the browser has no SW support, the script logs and does nothing.
- **Update checks**: `registration.update()` runs once at load and then **every 60 s** (`setInterval`).
- **Update banner**: on `updatefound`, when the new worker reaches `installed` and
  a controller already exists, a Spanish banner appears ("Nueva versión disponible",
  with "Actualizar" and "Después" buttons). In practice `sw.js` calls `skipWaiting()`
  during install, so the new SW activates right away anyway.
- **Auto-reload**: a `controllerchange` listener calls `window.location.reload()`.
  This also fires on the **first** visit, because `clients.claim()` gives an
  uncontrolled page its first controller.
- **Install prompt**: the script catches `beforeinstallprompt` (and calls `preventDefault()`
  to suppress the mini-infobar). If the app is not installed, it shows a custom
  prompt after **3 s** ("Instalar Still Louder", with "Instalar" and "Ahora no" buttons).
  The dismiss button sets `localStorage.installPromptDismissed = 'true'`, and the
  prompt never shows again in that browser. "Installed" means
  `display-mode: standalone` or iOS `navigator.standalone`.
- **Manual install**: any element with `data-pwa-install` triggers the deferred
  prompt. No page has such an element today.
- **Connection monitoring**: `online`/`offline` events send analytics and dispatch
  a `connectionchange` CustomEvent (`detail.online`) on `window`. Nothing listens for it.
- **Public API**: `window.StillLouderPWA` exposes `showInstallPrompt()`, `isInstalled()`,
  `getRegistration()`, `checkForUpdates()` and `clearCache()`.

### Analytics events emitted

These are sent through `gtag` only if `gtag` is defined. All use `event_category: 'pwa'`.

| Event | Source | Params |
|---|---|---|
| `pwa_initialized` | `sw-register.js` init | `installed: <bool>` |
| `pwa_install_prompt` | custom prompt "Instalar" | `event_label: accepted \| dismissed` |
| `pwa_install_dismissed` | custom prompt "Ahora no" | — |
| `pwa_manual_install` | `[data-pwa-install]` click | `event_label: <outcome>` |
| `pwa_install` | `appinstalled` | `event_label: 'app_installed'` |
| `connection_online` / `connection_offline` | `online`/`offline` events | — |
| `offline_page_view` | `offline.html` load | `event_label: 'offline_fallback'` |
| `pwa_shortcut` | `main.js` `initPWAShortcuts()` via `analytics.trackEvent` | `event_label: <action>` |

## Manifest (`public/assets/site.webmanifest`)

- `name` "Still Louder - Skirlaz", `short_name` "Still Louder", `lang: es`.
- `start_url: "/?source=pwa"`, `scope: "/"`, `display: standalone`, `orientation: portrait-primary`.
- `background_color` and `theme_color` are both `#0d1216`. This matches the
  `theme-color` of `index.html`, `offline.html` and the pre-release page.
- **Icons**: `/assets/favicon-96x96.png` (96, any), `/assets/web-app-manifest-192x192.png`
  and `-512x512.png` (`any maskable`), `/assets/apple-touch-icon.png` (180, any).
- **Screenshots**: `/assets/screenshot-mobile.png` (390x844, narrow) and
  `/assets/screenshot-desktop.png` (1920x1080, wide).
- **Shortcuts**: Spotify, Apple Music and YouTube (`/index.html?action=spotify|apple|youtube`),
  plus Pre-lanzamiento (`/al-vacio-pre-release.html`). `main.js` reads `?action=`,
  sends `pwa_shortcut`, and after 500 ms opens the platform URL in a new tab
  (`noopener,noreferrer`). The URLs come from `CONFIG.platforms`; the
  `action` keys map `apple` to `appleMusic`.
- `share_target`: GET to `/share` with `title`/`text`/`url`.

## Manual test checklist

Dev: `npm run dev` (http://localhost:3000; Vite serves publicDir at `/`, so
`/sw.js` resolves here). Prod-like: `npm run build && npm run preview` (serves
`dist/`, but sends **no** security headers). To test with the real Cloudflare
headers (CSP included), run `npx wrangler dev --local-protocol https` after a
build. Use HTTPS there: the CSP's `upgrade-insecure-requests` upgrades the
`/offline.html` → `/offline` redirect, which breaks the SW install on plain-http
`localhost`. SWs need `localhost` or HTTPS.

1. **Registration**: DevTools → Application → Service Workers. Expect `/sw.js`
   to be *activated and running*, scope `/`. The console shows `[SW Register]`
   and `[Service Worker]` logs.
2. **Caches**: Application → Cache Storage. Expect `still-louder-v<ver>-precache`,
   `-runtime` and `-images`, plus `still-louder-offline-v<ver>`. There should be no
   caches from older versions after activation.
3. **Offline**: Network → Offline (or Application → Service Workers → Offline) and
   reload. Visited pages come from cache. An unvisited URL shows `offline.html`.
   Images that were never cached show the "Offline" SVG placeholder. Uncheck
   Offline and `offline.html` auto-reloads.
4. **Install**: the custom prompt should appear about 3 s after `beforeinstallprompt`,
   or use the address-bar install icon. Click Install and check that the app opens
   standalone at `/?source=pwa`. To see the prompt again, clear
   `localStorage.installPromptDismissed` and uninstall.
5. **Shortcuts**: right-click the installed app icon (desktop) or long-press it (Android),
   pick a shortcut, and confirm the platform opens in a new tab.
6. **Update**: bump `CACHE_VERSION`, rebuild/reload, and wait up to 60 s or click
   Application → Service Workers → Update. The new SW activates, old caches are
   deleted, and the page reloads by itself.
7. **Reset**: Application → Storage → Clear site data, or run `StillLouderPWA.clearCache()`
   in the console, then unregister.
8. **Audit**: Lighthouse no longer has a PWA category (removed in Lighthouse 12).
   Use Application → Manifest for manifest and installability errors, and run
   Lighthouse for performance, accessibility, best practices and SEO.

## Known issues

Code-versus-reality discrepancies still open. The build/deploy gaps (SW,
offline page and manifest not shipped, precache 404s, CSP blocking the SW's
cross-origin fetches, no `Cache-Control` for `sw.js`) were fixed by moving the
files into publicDir; see git history.

1. **Stale naming.** The manifest says "Skirlaz" (`site.webmanifest:2`) while its
   shortcut descriptions say "Al Vacío". The `offline.html` footer reads
   "© 2025 … PWA v1.0.0" (`offline.html:371`).
2. **Update banner is redundant.** Unconditional `skipWaiting()` at install
   (`sw.js:63`) plus `controllerchange` → `reload()` (`sw-register.js:76-79`) means
   updates apply and reload automatically, and the banner at best flashes. The same
   reload also fires on the first-ever visit, because of `clients.claim()` (`sw.js:90`).
3. **Debug logging in production.** `debug: true` (`sw-register.js:13`) and the
   unconditional `console.log` calls throughout `sw.js` go against the no-`console.log` convention.
4. **Shortcut URLs** point at `/index.html?action=…` and `/al-vacio-pre-release.html`.
   Both hosts serve clean URLs (Vercel `cleanUrls`, Cloudflare `html_handling`),
   so these redirect. That works for navigation (they are not precached), but
   `/?action=…` and `/al-vacio-pre-release` would save a round trip.
5. **Duplicate unhashed JS/CSS in `dist/`.** publicDir copies every file under
   `public/assets/js/` and `public/assets/css/` to `/js/...` and `/css/...` even
   though the pages load the hashed bundles. They are dead weight, not broken.
6. **Plain-http CSP testing.** With the production CSP on `http://localhost`
   (`wrangler dev` without `--local-protocol https`), `upgrade-insecure-requests`
   upgrades the `/offline.html` → `/offline` redirect to `https://localhost` and
   the SW never finishes installing. Production is HTTPS-only, so this only
   affects local testing.
