# Main site: SEO and accessibility reference

Scope: the static main site (`public/`, Vite root). The ticket system
(`ticket-system/`) is a separate app and is not covered here.

Pages: `public/index.html` (home, current single **Skirlaz**, shows, band,
FAQ, contact) and `public/al-vacio-pre-release.html` (legacy pre-release page
for **Al Vacío**). `public/assets/offline.html` is the service-worker fallback only.

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
| `index.html` | `MusicRecording` (Skirlaz, with `recordingOf` `MusicComposition`, `inAlbum` `MusicAlbum` Single, `offers` `AggregateOffer` of streaming links), `MusicGroup` (`@id` `https://still-louder.com/#band`, sameAs, foundingLocation), two `MusicEvent` blocks (one per upcoming show, with `location` `MusicVenue`, `performer`, `offers`), `WebSite` |
| `al-vacio-pre-release.html` | `MusicRecording` (Al Vacío), `MusicGroup` (same `#band` `@id`), `WebPage` with `BreadcrumbList` (Inicio > Al Vacío) |

Other blocks reference the band as `{ "@id": "https://still-louder.com/#band" }`.
Keep that `@id` stable.

### 1.3 Sitemap and robots

- `public/assets/sitemap.xml` lists two URLs: `/` (priority 1.0, image = Skirlaz
  cover) and `/al-vacio-pre-release` (priority 0.8, image = imgur cover). It
  uses the `image:` sitemap extension.
- `public/assets/robots.txt`: a single `User-agent: *` group with `Allow: /`
  and `Disallow` for `/*.mp3$`, `/.git/`, `/node_modules/` and `/dist/`, plus
  `Sitemap: https://still-louder.com/sitemap.xml`. No `Crawl-delay` (Google
  ignores it) and no per-bot groups (a named group makes that bot ignore the
  `*` rules). Don't disallow `/assets/`: the hashed JS/CSS live there and
  Google needs them to render.

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
5. `public/assets/sitemap.xml`: `<lastmod>`, `image:loc`, `image:title` and
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
  (share, and the mobile menu).
- **Mobile menu** (`index.html` `#mobile-menu-btn`, `initMobileMenu()` in
  `main.js`): the button has a static `aria-label="Menú"`,
  `aria-expanded` and `aria-controls="mobile-menu"`. Opening moves focus to
  the first link, and Tab cycles between the button and the links while the
  overlay is open. Escape or the button closes it and returns focus to the
  button. Following a link closes it and focus goes to the target section.
  The closed menu uses `visibility: hidden`, so it stays out of the tab order;
  on open, `visibility` flips without a transition so the link can take focus.
- **In-page anchors** (`initSmoothScroll()`): the handler calls
  `preventDefault()` for the smooth scroll, so it moves focus to the target
  itself (adding `tabindex="-1"` when needed). This covers the skip link.
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
  (`style.css`, "FOCUS STYLES"). Elements with `tabindex="-1"` (sections
  focused by the anchor handler) get no outline. Form fields replace the outline with a
  border-plus-glow ring.
- **Reduced motion**: a global `prefers-reduced-motion: reduce` rule in
  `variables.css` cuts all animation and transition durations and disables
  smooth scroll. There are also component-level overrides in `style.css`.
  Scroll-reveal (`.reveal-up`) depends on JS (IntersectionObserver). Without
  JS, those elements stay at their initial hidden state.
- **Contrast tokens** (`variables.css`, on `--color-bg-primary #0d1216`):
  text-primary 18.8:1, text-secondary (70% white) 9.5:1, text-muted (50%
  white) 5.3:1, accent `#c0282e` 3.2:1, accent-hover `#e0454b` 4.6:1,
  accent-text `#e06b70` 5.8:1 (4.9:1 on `--color-bg-tertiary`). Use
  `--color-accent-text` whenever the accent is the color of text; keep
  `--color-accent` for fills, borders and buttons, which only need 3:1. The
  skip link is white on the accent (5.9:1). There are also
  `prefers-contrast: high` and `print` overrides.

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
      menu (open → focus on first link, Tab cycles, Escape → focus back on the
      button), FAQ, form submit, visible focus everywhere.
- [ ] Screen reader smoke test (VoiceOver or NVDA): landmarks list, heading
      outline (one h1), link names, form errors and the success toast
      announced.
- [ ] OS "reduce motion" enabled: no reveal or pulse animations.

---

## 4. Known issues (documented, not fixed)

Fixed and removed from this list (see git history): the Halloween JSON-LD
image path, the placeholder/made-up JSON-LD fields and `SearchAction`, the
robots.txt groups and disallows, accent-as-text contrast and the skip link,
the mobile menu's ARIA state and focus handling, and the pre-release page's
nested footer, inline skip-link style/JS and `theme-color`.

- **MusicEvent completeness**: neither event has `endDate`, and the
  Stratovarius `offers` has no `price` (`index.html`). Rich Results flags both
  as warnings. Don't add them until the real values are known.
- **`#band` image on the pre-release page**: its `MusicGroup` (same `@id`
  as home, `al-vacio-pre-release.html:144-172`) now matches home's logo,
  genre, founding date (2009) and location, but `image` is still the imgur
  cover until it is self-hosted (next item).
- **Hotlinked imgur images**: the pre-release page's OG image, Twitter image,
  JSON-LD image, sitemap image and cover `<img>` load
  `https://i.imgur.com/CoA13WN.jpg`, and its CSS background is
  `https://i.imgur.com/N1DNYjI.jpg`. Self-hosting needs the original files in
  `public/assets/images/`; after that, `i.imgur.com` can leave the CSP and
  `sw.js`.
- **Small OG image**: 640x640 (`index.html:85`) is below the 1200x630
  recommended for `summary_large_image`.
- **Unverified handle**: `twitter:site`/`creator` `@StillLouder`
  (`index.html:108`) is not among the band's `sameAs` or `rel="me"`
  profiles.
- **Focus outline contrast**: the global `:focus-visible` outline uses
  `--color-accent` (3.2:1 on the page background, below 3:1 on
  `--color-bg-tertiary` cards).
- **Pre-release page**, from Lighthouse: the `.release-link` ("Escúchalo en…")
  has an `aria-label` that does not contain its visible text
  (`label-content-name-mismatch`), and `#nameInput` is below the 24px touch
  target size. The sponsors carousel CSS (`sponsors-carousel.css`) targets
  `.sponsor-img`/`.sponsors-carousel-container`, which the markup does not
  use (it has `.sponsor-track`), so the logos render as a vertical stack.
