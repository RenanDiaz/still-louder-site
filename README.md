# Still Louder — Al Vacío

Official website for **Still Louder**, a Panamanian rock band, promoting their
single **"Al Vacío"**. A modern, fast, and accessible landing page built with
progressive-enhancement principles that links fans to every streaming platform.

🌐 **Live:** https://stilllouder.space/

---

## What's in this repository

This repo holds **two independent applications** that share a single git history
but deploy as **separate Vercel projects** to **different domains**:

| | Main site | Ticket system |
|---|---|---|
| **Location** | repo root (`public/`, `scripts/`, …) | [`ticket-system/`](ticket-system/) |
| **Purpose** | Static landing page for "Al Vacío" | Ticket sales, issuance & gate validation |
| **Stack** | Vite + vanilla ES6 modules + CSS | Vite + React + TypeScript + serverless API |
| **Domain** | https://stilllouder.space/ | https://entradas.stilllouder.space |

The two apps have **independent** build configs, dependencies, security headers,
and `public/` directories — a change in one does not affect the other. This
README documents the **main site**. For the ticketing app, see
[`ticket-system/README.md`](ticket-system/README.md).

---

## Features

- **Performance**
  - Vite build with code splitting and minification (Terser)
  - Image optimization (WebP / AVIF) via Sharp
  - Lazy loading for images
  - Gzip and Brotli precompression

- **Progressive Web App**
  - Service Worker with per-resource caching strategies
  - Offline fallback page
  - Installable web app manifest

- **User Experience**
  - Skeleton loading states and staggered animations
  - Web Share API with clipboard fallback
  - Toast notifications for feedback
  - Respects `prefers-reduced-motion`

- **Analytics (Google Analytics 4)**
  - Streaming platform and social click tracking
  - Audio player, scroll depth, and engagement-time events
  - Error tracking

- **Security**
  - Strict Content Security Policy and security headers (`vercel.json`)
  - HSTS, X-Frame-Options, nosniff, restrictive Permissions-Policy
  - `.well-known/security.txt` contact info

- **SEO & Accessibility**
  - WCAG 2.1 Level AA compliant, full keyboard navigation, ARIA labels
  - Sitemap, robots.txt, structured metadata

- **Maintainable Architecture**
  - Modular ES6 modules with a centralized config
  - CSS custom-property design system
  - Code quality enforced with ESLint + Prettier

---

## Technology Stack

| Technology | Purpose |
|------------|---------|
| Vite 7 | Build tool (hot reload, minification, compression) |
| ES6 Modules | JavaScript module system |
| CSS3 | Styling with CSS custom properties |
| Sharp | Image optimization |
| ESLint + Prettier | Linting and formatting |
| Google Analytics 4 | Analytics |
| Vercel | Hosting & deployment |

**Required Node.js version:** >= 18

---

## Project Structure

```
still-louder-site/
├── public/                          # Vite root (source files)
│   ├── assets/
│   │   ├── css/
│   │   │   ├── variables.css         # Design system tokens
│   │   │   ├── style.css             # Main styles
│   │   │   └── al-vacio-pre-release/ # Pre-release page styles
│   │   ├── js/
│   │   │   ├── config.js             # Centralized configuration
│   │   │   ├── analytics.js          # GA4 tracking
│   │   │   ├── share.js              # Web Share API
│   │   │   ├── error-handler.js      # Global error handling
│   │   │   ├── ui-utils.js           # UI utilities
│   │   │   ├── sw-register.js        # Service Worker registration
│   │   │   └── al-vacio-pre-release/ # Pre-release page scripts
│   │   ├── images/                   # Optimized images (WebP/AVIF)
│   │   ├── site.webmanifest          # PWA manifest
│   │   └── links.json                # Platform links data
│   ├── .well-known/security.txt      # Security contact
│   ├── index.html                    # Main landing page
│   ├── al-vacio-pre-release.html     # Pre-release page
│   ├── offline.html                  # Offline fallback
│   ├── sw.js                         # Service Worker
│   ├── sitemap.xml                   # SEO sitemap
│   └── robots.txt                    # Crawler directives
├── scripts/optimize-images.js        # Image optimization script
├── ticket-system/                    # Separate ticketing app (own README)
├── vite.config.js                    # Build configuration
├── vercel.json                       # Security headers & caching
└── package.json                      # Dependencies and scripts
```

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A modern web browser

### Installation

```bash
git clone https://github.com/RenanDiaz/still-louder-site.git
cd still-louder-site
npm install
```

### Development

```bash
npm run dev
# Available at http://localhost:3000 (opens automatically)
```

### Building for Production

```bash
npm run build     # Build optimized bundle to dist/
npm run preview   # Preview the production build locally
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Build the production bundle to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint on JavaScript |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting |
| `npm run validate` | Run lint + format check (run before committing) |
| `npm run optimize:images` | Optimize images with Sharp |

---

## Configuration

All URLs, settings, and constants are centralized in
[`public/assets/js/config.js`](public/assets/js/config.js):

```javascript
export const CONFIG = {
  platforms: { /* Streaming platform URLs */ },
  social:    { /* Social media links */ },
  analytics: { /* Google Analytics settings */ },
  release:   { /* Release information */ },
  site:      { /* Site metadata */ },
  messages:  { /* User-facing messages */ },
  features:  { /* Feature flags */ },
  ui:        { /* UI timings and settings */ }
};
```

Design tokens (colors, typography, spacing, shadows, transitions) live in
[`public/assets/css/variables.css`](public/assets/css/variables.css).

---

## Deployment

The main site auto-deploys to **Vercel** from the `main` branch. Security headers
and caching rules are defined in [`vercel.json`](vercel.json).

```bash
npm i -g vercel
vercel --prod
```

The ticket system is deployed as a **separate** Vercel project — see
[`ticket-system/README.md`](ticket-system/README.md).

Both apps can also deploy to **Cloudflare Workers** (`wrangler.jsonc` in the
root and in `ticket-system/`) — see [`DEPLOY_CLOUDFLARE.md`](DEPLOY_CLOUDFLARE.md).

---

## Contributing

1. Create a feature branch (`git checkout -b feat/amazing-feature`)
2. Make your changes and run `npm run validate`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `chore:`)
4. Push the branch and open a Pull Request

For deeper architecture and contribution notes, see
[`CLAUDE.md`](CLAUDE.md).

---

## Documentation

| File | Contents |
|------|----------|
| [`CLAUDE.md`](CLAUDE.md) | Full architecture & contributor guide |
| [`SECURITY_SUMMARY.md`](SECURITY_SUMMARY.md) | Security implementation details |
| [`PWA_IMPLEMENTATION.md`](PWA_IMPLEMENTATION.md) | Service Worker & PWA details |
| [`SEO_ACCESSIBILITY_SUMMARY.md`](SEO_ACCESSIBILITY_SUMMARY.md) | SEO & accessibility work |
| [`PHASE_5_6_IMPLEMENTATION.md`](PHASE_5_6_IMPLEMENTATION.md) | UX/UI improvements |
| [`PLAN_DE_MEJORAS.md`](PLAN_DE_MEJORAS.md) | Complete improvement plan |

---

## Connect with Still Louder

- Instagram: [@still_louder](https://www.instagram.com/still_louder/)
- Facebook: [stilllouder](https://www.facebook.com/stilllouder/)
- YouTube: [@StillLouder](https://www.youtube.com/@StillLouder)

---

## License

Code is distributed under the MIT License (see `package.json`). Music, artwork,
and brand assets are © Still Louder — all rights reserved.

---

**Made with passion for independent music** 🎸
