# Main site security reference

Current security posture of the **main site** (`https://still-louder.com`, Vite
root `public/`, publicDir `public/assets/`). The ticket system
(`entradas.still-louder.com`) is a separate app with its own CSP in
`ticket-system/vercel.json` and `ticket-system/public/_headers`. Nothing here
applies to it.

The site is static: no server code, no cookies of its own, no user accounts.
The attack surface is the HTML/JS we ship, the third parties we load, and the
two Google Forms we post to.

## Where headers live (the rule)

Headers are **duplicated** and must be changed in **both** files:

| Host | File | Notes |
|---|---|---|
| Vercel | `vercel.json` → `headers` | Rollback path. |
| Cloudflare Workers | `public/assets/_headers` | Vite copies publicDir to the `dist/` root, so it ships as `dist/_headers`. `wrangler.jsonc` is an assets-only Worker serving `./dist`. On Vercel, `/_headers` is served as an inert public file. |

After editing either file, diff the two (see "Drift" below for the current
state) and verify the live headers with `curl -sI`.

## Response headers (all paths, `/*` / `/(.*)`)

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see next table | Limits script, style, frame and connection origins. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | 2-year HTTPS-only. `includeSubDomains` also covers `www.` and `entradas.`, so every subdomain must serve HTTPS. |
| `X-Frame-Options` | `DENY` | Legacy clickjacking guard (same as `frame-ancestors 'none'`). |
| `X-Content-Type-Options` | `nosniff` | Stops MIME sniffing. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Only the origin is sent cross-site. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()` | Turns off browser features the site does not use. `interest-cohort` is obsolete (FLoC) and harmless. |
| `X-XSS-Protection` | `1; mode=block` | Legacy and ignored by modern browsers. Kept because scanners check for it. |
| `X-DNS-Prefetch-Control` | `on` | Performance only. Works with the `preconnect`/`dns-prefetch` hints. |

Caching headers (`Cache-Control`) are also in both files. They are not
security-relevant, except that HTML is `max-age=0, must-revalidate`, so a
fixed page takes effect right away.

### CSP, directive by directive

| Directive | Value | Reason |
|---|---|---|
| `default-src` | `'self'` | Fallback for anything not listed. |
| `script-src` | `'self' https://www.googletagmanager.com https://www.google-analytics.com 'unsafe-inline'` | gtag.js loader (GA4 `G-ZZ4XG8CD88`) and the inline gtag bootstrap in both pages (see Limitations). |
| `style-src` | `'self' https://fonts.googleapis.com 'unsafe-inline'` | Google Fonts CSS (Inter, Bebas Neue). `'unsafe-inline'` for the `style="..."` markup injected by `sw-register.js` and the pre-release skip-link script. |
| `font-src` | `'self' https://fonts.gstatic.com` | Google Fonts files. |
| `img-src` | `'self' https://i.imgur.com https://i.ytimg.com data: blob:` | `i.imgur.com`: pre-release cover (`al-vacio-pre-release.html`) and hero background (`css/al-vacio-pre-release/style.css`). `i.ytimg.com`: YouTube thumbnails for the embed. `data:`: Vite inlines assets under 4 KB as base64. |
| `connect-src` | `'self' https://www.google-analytics.com https://www.googletagmanager.com https://docs.google.com https://fonts.googleapis.com https://fonts.gstatic.com https://i.imgur.com https://i.ytimg.com` | GA4 beacons. `docs.google.com` for the `fetch` POST to the Google Forms (contact and pre-release comments). **If you remove it, both forms break and show no error.** The Google Fonts, `i.imgur.com` and `i.ytimg.com` origins are there for the service worker: `sw.js` is served with this same CSP and every request it makes is a `fetch` (precache of the Fonts CSS, runtime caching of font files and those images). Remove one and the SW install or its caching of that origin fails. |
| `media-src` | `'self'` | Self-hosted MP3 on the pre-release page. |
| `frame-src` | `'self' https://www.youtube-nocookie.com https://www.youtube.com` | The lyric-video iframe (`youtube-nocookie.com/embed/...`). `youtube.com` covers redirects/fallback. |
| `frame-ancestors` | `'none'` | The site cannot be framed. |
| `base-uri` | `'self'` | Blocks `<base>` hijacking. |
| `form-action` | `'self'` | Native form submissions stay same-origin. The Google Form posts are `fetch`, so `connect-src` governs them, not `form-action`. |
| `object-src` | `'none'` | No plugins. |
| `upgrade-insecure-requests` | — | Upgrades any stray `http:` subresource. |

## Links policy

- Every `target="_blank"` anchor in `index.html` and
  `al-vacio-pre-release.html` has `rel="noopener noreferrer"` (checked
  mechanically; no exceptions found). Keep it that way for new links.
- JS-opened windows: `main.js` PWA shortcuts use `window.open(url, '_blank')`
  **without** `noopener` (see Drift). New code should pass
  `'noopener,noreferrer'` as the third argument.
- The YouTube embed uses `youtube-nocookie.com` with
  `referrerpolicy="strict-origin-when-cross-origin"`.
- No SRI: the only third-party script is gtag.js, and it is versionless and
  changes over time, so SRI would break it.

## Forms (no backend)

Both forms `POST` to **the same Google Form** (`.../formResponse`, field
`entry.1365306044`) via `fetch(url, { method: 'POST', mode: 'no-cors' })`. The
response is opaque, so "success" only means the request did not fail at the
network level.

- **Contact form** (`index.html#contacto`, `initContactForm()` in
  `public/assets/js/main.js`). Config-driven through `CONFIG.contact` (`config.js`),
  gated by `CONFIG.features.contact`. Client-side validation checks name length,
  an email regex and a non-empty message. Name, email and message are folded into
  the single Form field. **Honeypot:** the hidden `#contact-website` input. If it
  is filled, the form resets and pretends success, and nothing is sent. There is
  no rate limit or CAPTCHA, so Google Forms' own abuse handling is the only
  server-side control.
- **Pre-release comments form** (`al-vacio-pre-release.html`,
  `assets/js/al-vacio-pre-release/script.js`). It has no honeypot, and the Form
  URL is hardcoded instead of read from `CONFIG.comments`. See Drift: the script
  does not currently bind to this form.
- Data handling: submissions go to Google (the band's Form/Sheet). The site
  itself stores nothing. Do not add fields for sensitive data.

## robots.txt and security.txt

- `public/assets/robots.txt` (served at `/robots.txt`) disallows `/assets/js/`, `/assets/css/`, `/*.mp3$`,
  `/admin`, `/config` and similar paths. This is crawler etiquette, not access
  control, because the site has no private paths.
- `public/assets/.well-known/security.txt` (served at `/.well-known/security.txt`)
  has the RFC 9116 fields `Contact`, `Expires` 2027-09-28,
  `Preferred-Languages` and `Canonical`.
- Both live in publicDir (`public/assets/`), which Vite copies verbatim to the
  root of `dist/`. Files left loose in `public/` are not deployed.

## Known limitations

- **`'unsafe-inline'` in `script-src`**: needed by the inline gtag bootstrap
  (both pages) and the two inline scripts at the end of
  `al-vacio-pre-release.html` (skip-link focus styles, social-click tracking).
  JSON-LD blocks are data and do not need it. To remove it: move those scripts
  into `.js` files, or use CSP hashes. Nonces are not an option for a static
  host.
- **`'unsafe-inline'` in `style-src`**: needed by the `style="..."` markup that
  `sw-register.js` injects via `innerHTML` and by inline `element.style`
  writes. To remove it: switch to classes.
- `innerHTML` is used in `share.js`, `sw-register.js` and `error-handler.js`,
  only with static or developer-supplied strings. Never interpolate user input
  there.
- The contact form has no server-side validation, rate limiting or CAPTCHA
  (only the honeypot). Its success message cannot confirm delivery.
- `X-XSS-Protection` and `interest-cohort` are legacy values with no effect.

## Verification checklist

1. `curl -sI https://still-louder.com/` and `curl -sI https://still-louder.com/al-vacio-pre-release`:
   all headers from the table are present, with the same CSP on both hosts.
2. https://securityheaders.com/ on `still-louder.com`. Expect the
   `unsafe-inline` warning, and nothing missing.
3. https://observatory.mozilla.org/ on `still-louder.com`. Same expectation.
4. https://www.ssllabs.com/ssltest/ on `still-louder.com` and `www.still-louder.com`.
5. Browser DevTools console on both pages: no CSP violations. Exercise the
   YouTube embed, the fonts, GA (Network tab: the `collect` beacon returns
   200/204), the contact form submit, and the pre-release audio.
6. `/robots.txt`, `/sitemap.xml`, `/.well-known/security.txt` and `/sw.js` return 200,
   not the SPA/404. `/sw.js` has `Cache-Control: no-cache`.
7. `npm audit` at the repo root (dev dependencies only, since nothing from
   `node_modules` ships to the browser).
8. After any header change, confirm the `vercel.json` and `_headers` values
   match.

## Known issues / drift

Recorded here only. None of these are fixed yet.

1. **Pre-release comments form is unwired**: `script.js:16-19` queries
   `#comentario-form`, `#enviar-comentario`, `#comentario` and
   `#comentario-mensaje`. The HTML (`al-vacio-pre-release.html:344-373`) uses
   `#commentForm`, `#nameInput` and `#commentInput`. The form has no `action`,
   so without JS it does a native GET to the same page, which puts the name and
   comment in the URL (and the GA page_view). The script guards on the missing
   elements so the rest of its init (audio tracking, sponsors carousel) runs.
2. **Contact and comments share one Google Form/field**:
   `config.js:137-140` (`comments`) and `config.js:151-153` (`contact`), plus
   the hardcoded copy at `script.js:38,40`. Contact messages land in the
   comments sheet. `CONFIG.comments` is unused.
3. **security.txt uses the old domain**: `public/assets/.well-known/security.txt:1`
   has `Contact: mailto:security@stilllouder.space`, while `Canonical` is on
   `still-louder.com`. It also says "hosted on Cloudflare" (`:18`), but Vercel
   is still the rollback host.
4. **Image-only CSP only on Vercel, and probably dead**: `vercel.json:15` sets a
   strict CSP for `/assets/images/(.*)`, but `_headers` has no equivalent. On
   Vercel the later `/(.*)` rule (`vercel.json:149`) sets the same key and most
   likely overrides it. Verify with `curl -sI` on an image.
5. **Caching rule drift** between `vercel.json` and `_headers`:
   - Vercel forces `Content-Type` on `/assets/css`/`/assets/js`
     (`vercel.json:27-28,40-41`). `_headers` does not.
   - Vercel's audio rules (`vercel.json:55-80`: `/assets/**.mp3|wav|ogg`) vs
     `_headers:38` (`/assets/mp3/*` only).
   - Vercel's extension rules for root images and favicons
     (`vercel.json:82-143`) vs `_headers:43` (`/images/*` only).
   - HTML revalidation: Vercel by extension (`vercel.json:181-189,199-207`),
     Cloudflare by clean URL (`_headers:48-55`, so each new page needs its own
     line).
   - Neither host covers the unhashed `dist/js/*` and `dist/css/*` copies.
   The security headers themselves (CSP etc., `vercel.json:149-177` vs
   `_headers:11-18`) are identical.
6. **GA4 `connect-src` may be too narrow**: GA4 often beacons to
   `region1.google-analytics.com`/`*.analytics.google.com`, which the CSP
   (`vercel.json:149`, `_headers:11`) does not allow. Check the console for
   violations.
7. **`window.open` without `noopener`**: `public/assets/js/main.js:480`.
