# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the official website for **Still Louder**, a Panamanian rock band, promoting their single "Al Vacío". The site is a static, performant landing page that links to various streaming platforms and provides information about the release.

**Live URL**: https://stilllouder.space/
**Repository**: https://github.com/RenanDiaz/still-louder-site

---

## Two Separate Applications (Important)

This repository contains **two independent applications** that share a single
git repo but deploy as **separate Vercel projects** to **different domains**.
The rest of this document describes the **main site** unless stated otherwise.

| | Main site | Ticket system |
|---|---|---|
| Location | repo root (`public/`, `scripts/`, etc.) | `ticket-system/` |
| Purpose | Static landing page for the single "Al Vacío" | Ticketing flow (purchase, admin, gate validation) |
| Stack | Vite + vanilla ES6 modules + CSS | Vite + React + TypeScript + serverless API |
| Vercel project | Main project (root config) | **Separate** Vercel project (`ticket-system/vercel.json`) |
| Production domain | https://stilllouder.space/ | **Subdomain** `https://entradas.stilllouder.space` |
| Config files | root `vercel.json`, `vite.config.js`, `package.json` | `ticket-system/vercel.json`, `vite.config.ts`, `package.json` |

**Key implications:**

- The two apps have **independent** build configs, dependencies, security
  headers (CSP), and `public/` static directories. A change in one does **not**
  affect the other.
- The ticket system is a multi-page React app (`entradas`, `admin`, `validar`,
  plus a redirecting `index`) with its own serverless backend under
  `ticket-system/api/`. See `ticket-system/README.md` for its architecture and
  deployment.
- **Shared assets are not actually shared at runtime** — they live in separate
  Vercel deployments. To use the same asset in both (e.g. the favicon), the
  file must be **copied** into each app's own `public/` directory and referenced
  with that app's root-relative paths.

---

## Ticket System (`ticket-system/`)

Ticket sales, issuance and gate validation for the **When We Were Young 3**
show. React 18 + TypeScript + Vite frontend, **Vercel Serverless Functions**
(TypeScript) backend, **Supabase (Postgres)** database, **Resend** for email,
**Yappy Botón de Pago V2** for in-app payment. Full details (env vars, Supabase
setup, Yappy flow, deployment) live in `ticket-system/README.md` — read it
before touching this app.

### Commands

```bash
cd ticket-system
npm install
npm run dev        # frontend only, http://localhost:3100
npm run typecheck  # tsc for BOTH src and api (tsconfig.json + tsconfig.api.json)
npm run build      # production build to ticket-system/dist/
```

The `/api` functions don't run under `npm run dev` — use `vercel dev` (Vercel
CLI) to serve frontend + serverless functions together with project env vars.
There is no test suite; `npm run typecheck` is the validation gate. The root
`npm run lint`/`format` scripts do **not** cover this app.

### Structure

- **Surfaces**, built as a Vite multi-page app (entries in
  `vite.config.ts`): `/entradas` (public purchase flow), `/ayuda` (public,
  static customer help: FAQ + official contact channels — no backend, no user
  data; the QR-resend self-service deliberately does NOT live here, the staff
  resend it from `/support` when a customer writes in), `/admin` (tabbed
  panel: reports, orders — mark paid / cancel pending / resend QR email —,
  ticket tracking with revoke/unrevoke, courtesy issuance, live check-in,
  stage-2 toggle, CSV export), `/validar` (gate QR scanner with
  camera + sound), `/support` (staff read-only customer support: look up orders
  by email/phone/name/order-id, view order + ticket status, resend QR email —
  no mutations, no sales stats; gated by `SUPPORT_PASSWORD` or the admin
  password via `isSupport()`), `/regalo/<token>` (public **hidden** gift-claim
  form, reachable only via a campaign QR token; `noindex`, never linked; the
  first N claimants get a `regalo` ticket — see `docs/features/gift-qr-campaigns.md`).
  Root `index.html` redirects to `/entradas`;
  `/when-we-were-young-3` rewrites to `/entradas` (`vercel.json`).
  `/ayuda` and `/regalo` reuse the public `/entradas` theme
  (`src/entradas/theme.css`), not the dark shared `styles.css` used by the staff
  surfaces.
- **Frontend**: `src/entradas/`, `src/ayuda/`, `src/admin/`, `src/validar/`,
  `src/support/`, `src/regalo/`, plus `src/shared/` (`api.ts`, `config.ts`, `styles.css`).
- **Backend**: `api/` serverless functions; shared server-only logic in
  `api/_lib/` (env access, Supabase service-role client, auth gates, HMAC,
  QR rendering, email, pricing, issuance, Yappy adapter). **Nothing in
  `api/_lib/` may ever be imported by client code.** Vercel Hobby caps a
  deployment at **12 serverless functions**, so ALL `/api/admin/*` routes share
  one function (`api/admin.ts`) reached via a `vercel.json` rewrite
  (`/api/admin/:path*` → `/api/admin?path=...`) — catch-all `[...path].ts`
  files do NOT work outside Next.js; count functions before adding a file
  under `api/`.
- **Database**: `supabase/migrations/` — schema with RLS enabled and no
  policies (only the service-role key can access) plus atomic RPCs
  (`create_order`, `mark_order_paid`, `validate_ticket`, `presale_status`,
  `cleanup_expired_orders`, `mark_order_emailed`, `claim_gift`). Gift campaigns
  add the `gift_campaign`/`gift_claim` tables and a `regalo` tier / `gift`
  payment method (0008); `claim_gift` reserves a slot race-safely (same `FOR
  UPDATE` + conditional-`UPDATE` pattern as `create_order`) and `regalo`/`gift`
  are deliberately excluded from presale-capacity counting.

### Architecture invariants (do not break)

- **Payment-agnostic issuance**: the only thing that issues tickets (creates
  ticket rows + sends the email) is an order transitioning to `paid`, via the
  idempotent routine in `api/_lib/issue.ts`. Cash/CuantoApp trigger it from the
  admin "mark paid" button; Yappy triggers it from the authenticated IPN
  (`api/yappy/ipn.ts`). Never couple issuance to a specific payment provider,
  and never make it non-idempotent.
- **Server-authoritative pricing**: prices and reservation windows are derived
  server-side in `api/_lib/pricing.ts` from (tier, quantity). The client never
  sends amounts. Presale cutoff date is duplicated client/server on purpose —
  the server copy wins.
- **Signed QR**: ticket QR payload is `WWWY3.<ticket_id>.<sig>` (truncated
  HMAC-SHA256 with server-only `TICKET_HMAC_SECRET`). Validation recalculates
  the HMAC (timing-safe) **before** any DB query; claiming a ticket is a single
  atomic conditional `UPDATE`, so a QR is accepted exactly once.
- **Race-safe capacity**: presale quota checks serialize via
  `SELECT ... FOR UPDATE` on the single `event_config` row; expired pending
  reservations free their quota by timestamp instantly. The daily cleanup cron
  (`vercel.json` → `/api/admin/orders/cleanup`, daily because Vercel Hobby
  forbids hourly crons) is housekeeping only.
- **Secrets are server-only**: all env vars (Supabase service role, Resend,
  HMAC secret, admin/staff passwords, Yappy credentials) live exclusively in
  the serverless functions — none are exposed via `VITE_*`. Yappy's secret API
  calls happen in the backend; the browser only receives the
  transaction token for the `<btn-yappy>` web component.
- **Admin/staff auth**: every protected endpoint checks `ADMIN_PASSWORD` /
  `STAFF_PASSWORD` with timing-safe comparison (`api/_lib/auth.ts`).
- The ticket-system CSP (`ticket-system/vercel.json`) intentionally allows
  Supabase, Yappy and Firebase endpoints — keep it in sync when adding
  external calls.

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Vite | 7.x | Build tool with hot reload, minification, compression |
| ES6 Modules | - | JavaScript module system |
| CSS3 | - | Styling with CSS custom properties (variables) |
| ESLint | 8.x | Code linting |
| Prettier | 3.x | Code formatting |
| Terser | 5.x | JavaScript minification |
| Sharp | 0.33.x | Image optimization |
| Vercel | - | Hosting and deployment |
| Google Analytics 4 | - | Analytics tracking |

**Required Node.js version**: >=18.0.0

---

## Project Structure

```
still-louder-site/
├── public/                      # Source files (Vite root)
│   ├── assets/
│   │   ├── css/
│   │   │   ├── variables.css    # Design system tokens (colors, spacing, typography)
│   │   │   ├── style.css        # Main styles
│   │   │   └── al-vacio-pre-release/  # Pre-release page styles
│   │   ├── js/
│   │   │   ├── main.js          # Entry point (wires up the modules below)
│   │   │   ├── config.js        # Centralized configuration (URLs, settings)
│   │   │   ├── analytics.js     # GA4 tracking module
│   │   │   ├── share.js         # Web Share API module
│   │   │   ├── error-handler.js # Global error handling
│   │   │   ├── ui-utils.js      # UI utilities (loading states, lazy loading)
│   │   │   ├── sw-register.js   # Service Worker registration
│   │   │   └── al-vacio-pre-release/  # Pre-release page scripts
│   │   ├── images/              # Optimized images (WebP, AVIF formats)
│   │   ├── site.webmanifest     # PWA manifest
│   │   └── links.json           # Platform links data
│   ├── .well-known/
│   │   └── security.txt         # Security contact information
│   ├── index.html               # Main landing page
│   ├── al-vacio-pre-release.html # Pre-release page
│   ├── offline.html             # Offline fallback page
│   ├── sw.js                    # Service Worker
│   ├── sitemap.xml              # SEO sitemap
│   └── robots.txt               # Search engine directives
├── scripts/
│   └── optimize-images.js       # Image optimization script
├── ticket-system/               # SEPARATE app — see "Ticket System" section
├── dist/                        # Build output (generated, gitignored)
├── vite.config.js               # Vite configuration
├── vercel.json                  # Vercel deployment config (headers, caching)
├── eslint.config.js             # ESLint flat config (rules live here)
├── .eslintrc.json               # Legacy ESLint config (kept for tooling compat)
├── .prettierrc                  # Prettier configuration
└── package.json                 # Dependencies and scripts
```

**Vite quirk worth knowing**: in `vite.config.js`, `root` is `public/` and
`publicDir` is `assets` — i.e. the *source* directory doubles as the Vite root,
and `public/assets/` is treated as the static dir. Paths in HTML are
root-relative to `public/`. Keep this in mind before restructuring directories.

---

## Development Workflow

### Quick Start

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start Vite dev server with hot reload |
| `build` | `npm run build` | Build production bundle to `dist/` |
| `preview` | `npm run preview` | Preview production build locally |
| `lint` | `npm run lint` | Run ESLint on JavaScript files |
| `lint:fix` | `npm run lint:fix` | Auto-fix ESLint issues |
| `format` | `npm run format` | Format code with Prettier |
| `format:check` | `npm run format:check` | Check code formatting |
| `validate` | `npm run validate` | Run lint + format check |
| `optimize:images` | `npm run optimize:images` | Optimize images with Sharp |

### Before Committing

Always run validation before committing:
```bash
npm run validate
```

---

## Code Conventions

### JavaScript

- **Module system**: ES6 modules (`import`/`export`)
- **Quotes**: Single quotes (`'string'`)
- **Semicolons**: Required
- **Indentation**: 2 spaces
- **Max line length**: 120 characters
- **Variables**: Use `const` by default, `let` when reassignment needed, never `var`
- **Functions**: Prefer arrow functions for callbacks
- **No console.log**: Use `console.warn` or `console.error` only (linting rule)
- **Strict equality**: Always use `===` and `!==`
- **Trailing commas**: None

Example:
```javascript
import { CONFIG } from './config.js';

const handleClick = (event) => {
  const platform = event.target.dataset.platform;
  if (platform === 'spotify') {
    analytics.trackEvent('click_platform', { platform_name: 'spotify' });
  }
};

export default handleClick;
```

### CSS

- **Use CSS variables** defined in `variables.css` for all values
- **BEM-like naming**: `.component-name`, `.component-name__element`, `.component-name--modifier`
- **Mobile-first**: Base styles for mobile, media queries for larger screens
- **Prefer CSS transitions** over JavaScript animations
- **Respect `prefers-reduced-motion`** for accessibility

Example:
```css
.platform-link {
  background: var(--color-link-bg);
  padding: var(--spacing-md);
  border-radius: var(--border-radius-md);
  transition: all var(--transition-normal);
}

.platform-link:hover {
  background: var(--color-accent);
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .platform-link {
    transition: none;
  }
}
```

### HTML

- **Language**: `lang="es"` (Spanish content)
- **Semantic elements**: Use `<main>`, `<nav>`, `<section>`, `<footer>` appropriately
- **ARIA labels**: Add `aria-label` for interactive elements, especially links
- **External links**: Always include `target="_blank" rel="noopener noreferrer"`
- **SVG icons**: Include `aria-hidden="true" focusable="false"` on decorative SVGs

---

## Architecture Decisions

### Centralized Configuration (`config.js`)

All URLs, settings, and constants are centralized in `public/assets/js/config.js`. The config object is frozen to prevent accidental mutations.

```javascript
import { CONFIG } from './config.js';

// Access platform URLs
CONFIG.platforms.spotify.url

// Access UI settings
CONFIG.ui.animationDuration

// Access messages
CONFIG.messages.success.copiedToClipboard
```

### Design Tokens (`variables.css`)

All design values are CSS custom properties:
- Colors: `--color-*`
- Typography: `--font-*`
- Spacing: `--spacing-*`
- Borders: `--border-radius-*`
- Shadows: `--shadow-*`
- Transitions: `--transition-*`
- Z-index: `--z-*`

### Service Worker Strategies

The service worker (`sw.js`) uses different caching strategies:
- **Cache First**: Images, fonts (static assets)
- **Network First**: HTML pages (dynamic content)
- **Stale While Revalidate**: CSS, JavaScript (balance of speed and freshness)

### Security Headers

All security headers are configured in `vercel.json`:
- Content Security Policy (CSP)
- HSTS (2 years, preload ready)
- X-Frame-Options (DENY)
- X-Content-Type-Options (nosniff)
- Referrer-Policy (strict-origin-when-cross-origin)
- Permissions-Policy (restrictive)

---

## Key Files to Know

| File | Purpose | When to Modify |
|------|---------|----------------|
| `public/index.html` | Main landing page | Adding new sections, updating meta tags |
| `public/assets/js/config.js` | All URLs and settings | Changing links, messages, feature flags |
| `public/assets/css/variables.css` | Design tokens | Changing colors, spacing, typography |
| `public/assets/css/style.css` | Main styles | Styling changes |
| `vercel.json` | Security headers, caching | Security policy updates |
| `vite.config.js` | Build configuration | Build optimization changes |
| `public/assets/site.webmanifest` | PWA configuration | App name, icons, theme |

---

## Important Patterns

### Adding a New Platform Link

1. Add the platform config to `public/assets/js/config.js`:
```javascript
platforms: {
  newPlatform: {
    name: 'Platform Name',
    url: 'https://...',
    icon: 'platform-icon',
    color: '#hexcolor'
  }
}
```

2. Add the HTML in `public/index.html` following the existing pattern with proper ARIA labels.

3. Add brand color to `variables.css` if needed.

### Contact form (no backend)

The `#contacto` section posts to a **Google Form** with no backend of its own
(same trick as the `al-vacio-pre-release` comments form). `initContactForm()` in
`main.js` validates the fields, folds name + email + message into the Form's
single text field (`CONFIG.contact.messageField`), and submits via
`fetch(url, { mode: 'no-cors' })`. A hidden honeypot (`#contact-website`) drops
bot submissions. **The Form URL is config-driven (`CONFIG.contact`), and
`docs.google.com` must stay in the `connect-src` CSP directive in `vercel.json`
or the submit fails silently.** To capture separate columns instead of one
composed field, point `CONFIG.contact.formUrl`/`messageField` at a dedicated
Form (and extend the handler with per-field `entry.*` IDs).

### Tracking Analytics Events

Use the analytics module:
```javascript
import analytics from './analytics.js';

// Track custom event
analytics.trackEvent('event_name', {
  event_category: 'category',
  event_label: 'label'
});
```

### Showing User Feedback

Use toast notifications via the UI utils:
```javascript
import uiUtils from './ui-utils.js';

// Show success message
uiUtils.showToast(CONFIG.messages.success.copiedToClipboard, 'success');
```

---

## Testing Checklist

Before deploying, verify:

- [ ] `npm run validate` passes (lint + format)
- [ ] Dev server works: `npm run dev`
- [ ] Production build works: `npm run build && npm run preview`
- [ ] All platform links work and open in new tabs
- [ ] Share button works (or falls back to clipboard)
- [ ] No console errors in browser DevTools
- [ ] Page loads correctly on mobile viewport
- [ ] Keyboard navigation works (Tab, Enter)
- [ ] `prefers-reduced-motion` is respected

### Security Testing

After deployment:
- Check security headers at https://securityheaders.com/
- Run Mozilla Observatory scan: https://observatory.mozilla.org/
- Verify HTTPS: https://www.ssllabs.com/ssltest/

---

## Deployment

The site is deployed on **Vercel** and auto-deploys from the `main` branch.

### Manual Deployment

```bash
# Build
npm run build

# Deploy (if Vercel CLI installed)
vercel --prod
```

### Environment

- No environment variables required for basic functionality
- Google Analytics ID is hardcoded in `index.html` and `config.js`

---

## Common Tasks

### Update streaming platform URLs

Edit `public/assets/js/config.js` → `platforms` object and update the corresponding links in `public/index.html`.

### Change theme colors

Edit `public/assets/css/variables.css` → modify `--color-*` variables.

### Add new content section

1. Add semantic HTML to `public/index.html`
2. Add styles to `public/assets/css/style.css`
3. Use existing CSS variables for consistency

### Optimize new images

1. Add images to `public/assets/images/`
2. Run `npm run optimize:images`
3. Use the optimized WebP/AVIF versions in HTML with proper `srcset`

---

## Do's and Don'ts

### Do

- Use CSS variables from `variables.css` for all style values
- Add `aria-label` to all interactive elements
- Include `rel="noopener noreferrer"` on external links
- Use the centralized config for URLs and settings
- Respect `prefers-reduced-motion` for animations
- Run `npm run validate` before committing
- Keep JavaScript modules small and focused

### Don't

- Don't hardcode URLs - use `config.js`
- Don't add inline styles - use CSS classes with variables
- Don't use `var` - use `const` or `let`
- Don't use `console.log` in production code
- Don't skip accessibility attributes (ARIA labels, alt text)
- Don't modify the frozen CONFIG object
- Don't add dependencies without considering bundle size
- Don't remove security headers from `vercel.json`

---

## Commit Convention

Follow conventional commits:

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: formatting, no code change
refactor: code restructuring
perf: performance improvements
test: adding tests
chore: maintenance tasks
```

Examples:
```
feat: add TikTok platform link
fix: correct Apple Music URL encoding
style: format CSS with Prettier
perf: optimize cover image loading
```

---

## Related Documentation

- `README.md` - User-facing documentation (repo overview, both apps)
- `ticket-system/README.md` - Ticket system architecture, env vars, Supabase setup, Yappy integration, deployment
- `SECURITY_SUMMARY.md` - Detailed security implementation
- `PWA_IMPLEMENTATION.md` - Service Worker and PWA details
- `SEO_ACCESSIBILITY_SUMMARY.md` - SEO and accessibility work
- `PHASE_5_6_IMPLEMENTATION.md` - UX improvements documentation
- `PLAN_DE_MEJORAS.md` - Overall improvement plan (Spanish)

---

## Contact

- **Developer**: Renan Diaz
- **Band**: Still Louder
- **Social**: @still_louder on Instagram, @stilllouder on Facebook/YouTube
