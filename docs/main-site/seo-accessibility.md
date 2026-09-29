# Main site: SEO and accessibility reference

Scope: the static main site (`public/`, Vite root). The ticket system
(`ticket-system/`) is a separate app and is not covered here.

Pages: `public/index.html` (home, current single **Skirlaz**, shows, band,
FAQ, contact) and `public/al-vacio-pre-release.html` (legacy pre-release page
for **Al Vacío**). `public/offline.html` is the service-worker fallback only.

**Path rule you need for absolute URLs.** `vite.config.js` sets
`publicDir: 'assets'`, so a file at `public/assets/images/x.jpg` is published at
`https://still-louder.com/images/x.jpg`, **not** `/assets/images/x.jpg`.
Relative `src`/`href` values in HTML get rewritten by Vite. Absolute URLs in
meta tags, JSON-LD and the sitemap do not, so they must use `/images/...`.

---

## 1. SEO

### 1.1 Head metadata (both pages)

- `<title>`, `meta description`, `meta keywords` (search engines ignore
  keywords), `meta robots` = `index, follow, max-image-preview:large, ...`.
- `<link rel="canonical">`: home `https://still-louder.com/`, pre-release
  `https://still-louder.com/al-vacio-pre-release`. There is no `.html`
  suffix because `cleanUrls` is set in `vercel.json` and
  `html_handling: auto-trailing-slash` in `wrangler.jsonc`.
- Open Graph: `og:locale=es_PA`, `og:type=music.song`, title, description,
  url, site_name, image (+ `secure_url`, `alt`, `type`, `width`, `height`),
  `music:musician`, `music:release_date`, `music:song`. The home page also has
  `music:preview_url:youtube`.
- Twitter: `summary_large_image`, title, description, image and alt,
  `twitter:site`/`creator`. The home page adds `label1/data1` and
  `label2/data2`.
- Home only: geo tags (`geo.region=PA`, `geo.position`, `ICBM`), `rel="me"` and
  `og:see_also` links to Instagram, Facebook, YouTube and TikTok, and
  `theme-color #0d1216`.
- Share image: home uses `/images/album_covers/skirlaz.jpeg` (640x640).
  Pre-release uses a hotlinked `https://i.imgur.com/CoA13WN.jpg`.

### 1.2 Structured data (JSON-LD, inline `<script type="application/ld+json">`)

| Page | Types |
|---|---|
| `index.html` | `MusicRecording` (Skirlaz, with `recordingOf` `MusicComposition`, `inAlbum` `MusicAlbum` Single, `offers` `AggregateOffer` of streaming links), `MusicGroup` (`@id` `https://still-louder.com/#band`, sameAs, foundingLocation), two `MusicEvent` blocks (one per upcoming show, with `location` `MusicVenue`, `performer`, `offers`), `WebSite` (with `SearchAction`) |
| `al-vacio-pre-release.html` | `MusicRecording` (Al Vacío), `MusicGroup` (same `#band` `@id`), `WebPage` with `BreadcrumbList` (Inicio > Al Vacío) |

Other blocks reference the band as `{ "@id": "https://still-louder.com/#band" }`.
Keep that `@id` stable.

### 1.3 Sitemap and robots

- `public/sitemap.xml` lists two URLs: `/` (priority 1.0, image = Skirlaz
  cover) and `/al-vacio-pre-release` (priority 0.8, image = imgur cover). It
  uses the `image:` sitemap extension.
- `public/robots.txt`: `Allow: /` for `*`, `Disallow` for `/assets/js/`,
  `/assets/css/`, `/*.mp3$`, `/admin`, `/config`, `/.git/`, `/node_modules/`,
  `/dist/`, and `Crawl-delay: 10` for generic bots, AhrefsBot and SemrushBot.
  It has a separate group for Googlebot, Bingbot, Slurp and DuckDuckBot with
  `Allow: /`. Because of that group, those crawlers ignore the `*`
  disallows. It also has `Sitemap: https://still-louder.com/sitemap.xml`.

### 1.4 Checklist: new release (new single on the home page)

1. `public/index.html`: `<title>`, `description`, `keywords`, all `og:*`,
   `music:release_date`, `music:preview_url:youtube`, all `twitter:*`
   (including image and alt, `data2` year).
2. `public/index.html` JSON-LD `MusicRecording`: `name`, `image`,
   `datePublished`, `recordingOf.name`, `inAlbum.*`, every `offers[].url`,
   and `offerCount`. Fill in `isrcCode`/`iswcCode` or remove them.
3. `public/index.html` body: hero `<picture>` sources and `alt`, the `<h1>`,
   the YouTube iframe `src` and `title`, and the `aria-label`s of the
   platform links.
4. `public/assets/js/config.js` (`platforms.*` URLs) and
   `public/assets/links.json`.
5. `public/sitemap.xml`: `<lastmod>`, `image:loc`, `image:title` and
   `image:caption` for `/`.
6. Export the new cover as `/images/...` (JPEG for OG, plus AVIF and WebP for
   `<picture>`), then run `npm run optimize:images`.

### 1.5 Checklist: shows

Each show needs a card in `#shows` (flyer `<picture>` with a descriptive
`alt`, plus a ticket link with `aria-label`) and a matching `MusicEvent`
JSON-LD block. When a show has passed, remove its `MusicEvent` block and move
the card to the "Último show" list.

### 1.6 Checklist: domain change

Grep `public/` for the old host and replace it in all of these places:
canonical, `og:url`, `og:image*`, `music:*`, `twitter:image`, every JSON-LD
`url`/`@id`/`image`/`item`/`urlTemplate`, `sitemap.xml` (`loc`,
`image:loc`), `robots.txt` (comment and `Sitemap:`), `.well-known/security.txt`
(`Contact`, `Canonical`), `assets/js/config.js` (share URL, ticket/help URLs),
and `assets/js/main.js` (share URL). Also update `site.webmanifest` if it
contains absolute URLs. Then resubmit the sitemap in Search Console.

---

## 2. Accessibility conventions in use

- **Language**: `<html lang="es">` on every page.
- **Landmarks**: `<header>`, `<nav aria-label="Navegación principal">`,
  `<nav aria-label="Navegación móvil">`, `<main id="main-content">`, and
  `<footer>` as a sibling of `main`. Sections use `<section id=...>` with an
  `<h2>`. There is one `<h1>` per page. The platform grid is a
  `<nav aria-label="Enlaces a plataformas de streaming">`. Explicit
  `role="main"`, `role="navigation"` and `role="contentinfo"` are redundant
  with the elements but harmless.
- **Skip link**: the first focusable element is
  `<a href="#main-content" class="skip-link">`, positioned off-screen and
  shown on `:focus` (`style.css`, `.skip-link`).
- **Links and buttons**: every external link has
  `target="_blank" rel="noopener noreferrer"` and an `aria-label` that ends
  with "(se abre en nueva ventana)". Icon-only buttons have an `aria-label`
  (share, and the mobile menu, which switches between "Abrir menú" and
  "Cerrar menú" in `main.js`). Escape closes the mobile menu, and the closed
  menu uses `visibility: hidden`, so it stays out of the tab order.
- **SVG icons** are decorative and carry `aria-hidden="true"`
  (`focusable="false"` is not used consistently). Status dots use
  `aria-hidden`.
- **Images**: all `<img>` have meaningful Spanish `alt`. Flyer alts spell out
  the date, venue and ticket info. Duplicated marquee sponsor logos on the
  pre-release page are `aria-hidden`. The iframe has a `title`.
- **Forms** (`#contacto`): every field has a `<label for>`, `autocomplete`
  and `required`. The honeypot is wrapped in `aria-hidden` with
  `tabindex="-1"`. The submit button gets `aria-busy` while sending.
  Feedback uses toasts inside `#toast-container` (`aria-live="polite"`, and
  toasts set `role="alert"` or `status`).
- **Focus**: global `:focus-visible` shows a 2px accent outline
  (`style.css`, "FOCUS STYLES"). Form fields replace the outline with a
  border-plus-glow ring.
- **Reduced motion**: a global `prefers-reduced-motion: reduce` rule in
  `variables.css` cuts all animation and transition durations and disables
  smooth scroll. There are also component-level overrides in `style.css`.
  Scroll-reveal (`.reveal-up`) depends on JS (IntersectionObserver). Without
  JS, those elements stay at their initial hidden state.
- **Contrast tokens** (`variables.css`, on `--color-bg-primary #0d1216`):
  text-primary 18.8:1, text-secondary (70% white) 9.5:1, text-muted (50%
  white) 5.3:1, accent `#c0282e` 3.2:1, accent-hover `#e0454b` 4.6:1. There
  are also `prefers-contrast: high` and `print` overrides.

---

## 3. Verification checklist

- [ ] Lighthouse (mobile) SEO and Accessibility audits on both pages, run on
      the deployed URL.
- [ ] Rich Results Test / Schema Markup Validator on `/` and
      `/al-vacio-pre-release`, with no errors in the `MusicEvent` or
      `MusicRecording` blocks.
- [ ] Facebook Sharing Debugger and a link preview in WhatsApp or X, to check
      the OG image loads (not a 404) and the title and description are
      current.
- [ ] Every absolute URL in meta, JSON-LD and the sitemap returns 200 on
      production (`curl -I`).
- [ ] axe DevTools scan, then a keyboard-only pass: skip link, nav, mobile
      menu (open, Escape), FAQ, form submit, visible focus everywhere.
- [ ] Screen reader smoke test (VoiceOver or NVDA): landmarks list, heading
      outline (one h1), link names, form errors and the success toast
      announced.
- [ ] OS "reduce motion" enabled: no reveal or pulse animations.

---

## 4. Known issues (documented, not fixed)

- **Wrong image path in JSON-LD**: the Halloween `MusicEvent` `image` uses
  `https://still-louder.com/assets/images/shows/...`
  (`index.html:303`). Because of `publicDir: 'assets'`, the file is served at
  `/images/shows/...` (the Stratovarius block at `index.html:270` gets this
  right), so this URL will 404 in production.
- **Old domain**: `public/.well-known/security.txt:1` still uses
  `mailto:security@stilllouder.space`. No other file in `public/` references
  `stilllouder.space`.
- **Placeholder or empty structured data** in `index.html`: `isrcCode: ""`
  (126), `iswcCode: ""` (157), `offerCount: "5"` with only 3 offers and no
  `lowPrice` (171), `sameAs` with placeholder URLs
  `https://www.deezer.com/artist/...` and `https://music.amazon.com/artists/...`
  (246–247), `contactPoint` with no email, url or telephone (249), a made-up
  `memberOf` "Independent Artists" (254), and `logo` pointing to the single's
  cover instead of the band logo (220).
- **MusicEvent completeness**: neither event has `endDate`, and the
  Stratovarius `offers` has no `price` (`index.html:288–293`). Rich Results
  flags both as warnings.
- **SearchAction** (`index.html:359`) points at a Google `site:` search.
  Google no longer shows the sitelinks search box, so this block does
  nothing.
- **Conflicting `#band` entity**: the pre-release page redefines the
  `MusicGroup` with the same `@id` but imgur `logo`/`image`
  (`al-vacio-pre-release.html:151–152`).
- **Sitemap lastmod**: `/al-vacio-pre-release` has `2025-01-11`
  (`sitemap.xml:17`), which is older than the page's own `datePublished`
  `2025-07-28` (`al-vacio-pre-release.html:97`) and its later edits. Both
  sitemap URLs exist.
- **robots.txt**: there are two `User-agent: *` groups (lines 5 and 25).
  `Disallow: /assets/js/` and `/assets/css/` (10–11) would block rendering
  resources for any crawler that falls under `*`. `Allow: /assets/images/`
  (9, 37) does not match the published `/images/...` path.
  `Disallow: /admin` and `/config` (15–16) list paths that do not exist on
  the main site. `Crawl-delay: 0` (33) is ignored by Google.
- **Hotlinked imgur image**: the pre-release page's OG image, Twitter image,
  JSON-LD image, sitemap image and cover `<img>` all load from imgur
  (`al-vacio-pre-release.html:64,65,84,96,241`, `sitemap.xml:21`).
- **Small OG image**: 640x640 (`index.html:85`) is below the 1200x630
  recommended for `summary_large_image`.
- **Unverified handle**: `twitter:site`/`creator` `@StillLouder`
  (`index.html:108`) is not among the band's `sameAs` or `rel="me"`
  profiles.
- **Contrast**: accent `#c0282e` used as body-size text is 3.2:1, which
  fails WCAG AA 4.5:1. It is used in `style.css` for `.hero-subtitle`,
  `.shows-card__countdown`, `.about-text em`, `.faq-item__a a` and
  `.contact-form__alt a`. The skip link is `--color-text-dark` on accent,
  which is 3.0:1 (`style.css:45–46`).
- **Mobile menu**: the button has no `aria-expanded`/`aria-controls`
  (`index.html:407`, `main.js:162–174`). Focus is not moved into the menu
  or returned to the button when it closes.
- **Pre-release page markup**: the skip link uses inline styles plus an
  inline JS focus handler (`al-vacio-pre-release.html:234`, `471–490`),
  which goes against the no-inline-styles convention. The
  `<footer role="contentinfo">` is nested inside `<main>` (459), which is an
  invalid landmark nesting. `theme-color` is `#000000` (21), while home uses
  `#0d1216`.
