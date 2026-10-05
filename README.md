# Still Louder — official site

Official website for **Still Louder**, a Panamanian rock band: current single
(**"A Las 10"**), streaming links, upcoming shows, band info, FAQ, social links,
store and a contact form. Static, fast and accessible.

🌐 **Live:** https://still-louder.com/ · 🎟️ **Tickets:** https://entradas.still-louder.com

---

## What's in this repository

Two **independent applications** share this git repo but build and deploy
separately, to different domains:

| | Main site | Ticket system |
|---|---|---|
| **Location** | repo root (`public/`, `scripts/`, …) | [`ticket-system/`](ticket-system/) |
| **Purpose** | Band landing page | Ticket sales, issuance & gate validation |
| **Stack** | Vite + vanilla ES modules + CSS | Vite + React + TypeScript + serverless API + Supabase |
| **Domain** | `still-louder.com` | `entradas.still-louder.com` |

Build configs, dependencies, security headers and `public/` directories are
independent — a change in one does not affect the other. This README covers the
**main site**; for tickets see [`ticket-system/README.md`](ticket-system/README.md).

---

## Quick start

Requires Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production bundle → dist/
npm run preview    # serve the production build
```

| Script | Description |
|--------|-------------|
| `npm run dev` / `build` / `preview` | Vite dev server, production build, preview |
| `npm run lint` / `lint:fix` | ESLint on `public/assets/js` |
| `npm run format` / `format:check` | Prettier on `public/**/*.{js,css,html}` |
| `npm run validate` | lint + format check — **run before committing** |
| `npm run optimize:images` | Generate WebP/AVIF variants with Sharp |
| `npm run preview:cloudflare` / `deploy:cloudflare` | Build + `wrangler dev` / `wrangler deploy` |

---

## How it's built

- **Vite root is `public/`** and `public/assets/` is the static dir (copied
  verbatim to `dist/`). HTML paths are root-relative to `public/`.
- **Pages:** `index.html` (landing), `al-vacio-pre-release.html` (legacy page of
  the previous single), `public/assets/offline.html` (PWA fallback, served at `/offline.html`).
- **JS:** ES modules under `public/assets/js/`, wired from `main.js`. All URLs,
  dates and copy constants live in the frozen `CONFIG` in
  [`config.js`](public/assets/js/config.js) (`platforms`, `social`, `store`,
  `shows`, `release`, `site`, `contact`, `features`, …).
- **CSS:** design tokens in [`variables.css`](public/assets/css/variables.css),
  styles in `style.css`.
- **Service worker** (`public/assets/sw.js`, served at `/sw.js`) for
  offline/caching — bump its `CACHE_VERSION` when shipping HTML/CSS/JS changes.
  See [`docs/main-site/pwa.md`](docs/main-site/pwa.md).
- **Contact form** posts to a Google Form (no backend).
- **Analytics:** Google Analytics 4.

Full architecture, conventions and common tasks: [`CLAUDE.md`](CLAUDE.md).

---

## Deployment

The site runs on **Cloudflare Workers** (assets-only Worker) at
`still-louder.com`. Security/caching headers live in
`public/assets/_headers` (shipped as `dist/_headers`).

- Deploy: `npm run deploy:cloudflare` (config in `wrangler.jsonc`).
- Local preview of the Worker: `npm run preview:cloudflare`.

Step-by-step guide: [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md).

---

## Documentation

Index of all docs: [`docs/README.md`](docs/README.md).

| Doc | Contents |
|------|----------|
| [`CLAUDE.md`](CLAUDE.md) | Architecture, conventions, common tasks (main site + ticket system) |
| [`docs/main-site/pwa.md`](docs/main-site/pwa.md) | Service worker, manifest, offline, PWA testing |
| [`docs/main-site/security.md`](docs/main-site/security.md) | Security headers, CSP, verification |
| [`docs/main-site/seo-accessibility.md`](docs/main-site/seo-accessibility.md) | SEO metadata, structured data, a11y conventions |
| [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md) | Cloudflare deploy & domain cutover |
| [`ticket-system/README.md`](ticket-system/README.md) | Ticket system |

---

## Contributing

1. Branch off `main`.
2. Make your changes and run `npm run validate`.
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `chore:`).
4. Open a Pull Request.

---

## Connect with Still Louder

- Instagram: [@still_louder](https://www.instagram.com/still_louder/)
- Facebook: [stilllouder](https://www.facebook.com/share/1FRfEeLhhp/?mibextid=wwXIfr)
- YouTube: [@StillLouder](https://www.youtube.com/@StillLouder)

---

## License

Code is distributed under the MIT License (see `package.json`). Music, artwork,
and brand assets are © Still Louder — all rights reserved.
