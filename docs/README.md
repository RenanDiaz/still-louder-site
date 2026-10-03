# Documentation index

Where each document lives and what it covers. Start with the root
[`README.md`](../README.md) (overview) and [`CLAUDE.md`](../CLAUDE.md)
(architecture + conventions, also read by coding agents).

## Main site (repo root)

| Doc | Contents |
|---|---|
| [`main-site/pwa.md`](main-site/pwa.md) | Service worker, caching strategies, manifest, offline page, PWA test checklist |
| [`main-site/security.md`](main-site/security.md) | Security headers / CSP (Vercel + Cloudflare mirrors), links, forms, verification |
| [`main-site/seo-accessibility.md`](main-site/seo-accessibility.md) | Metadata, structured data, sitemap/robots, a11y conventions, verification |
| [`features/comunicados.md`](features/comunicados.md) | Spec: official band statements (`/comunicados`, build-time Markdown pages + home banner) — not implemented |

## Ticket system (`ticket-system/`)

| Doc | Contents |
|---|---|
| [`../ticket-system/README.md`](../ticket-system/README.md) | Architecture, env vars, Supabase, Yappy, operations — read before touching the app |
| [`features/multi-evento.md`](features/multi-evento.md) | Spec: multi-event foundation (`events` table, migration 0011) — implemented |
| [`features/entradas-31-10.md`](features/entradas-31-10.md) | Spec: Halloween Party sale (31 Oct 2026, slug `halloween-party`) |
| [`features/gift-qr-campaigns.md`](features/gift-qr-campaigns.md) | Spec: hidden-QR gift ticket campaigns (`/regalo/<token>`) |

## Deployment (both apps)

| Doc | Contents |
|---|---|
| [`deploy-cloudflare.md`](deploy-cloudflare.md) | Cloudflare Workers deploy for both apps and the cutover to `still-louder.com` (Vercel stays as rollback) |

## Conventions

- New feature specs go in `docs/features/<slug>.md` (spec-first); code comments
  and migrations link to them by path, so **don't rename a spec once code
  references it**.
- Reference docs describe the **current** state. Don't add per-phase
  "implementation summary" reports — the PR description and git history are
  the changelog. The old phase reports (`PLAN_DE_MEJORAS.md`,
  `FASE_1_SUMMARY.md`, `PHASE*_…md`, `SUMMARY.md`, `QUICKSTART.md`,
  `PWA_IMPLEMENTATION.md`, `SECURITY_SUMMARY.md`, `SEO_ACCESSIBILITY_SUMMARY.md`,
  `*TESTING_CHECKLIST.md`)
  were consolidated into the docs above and removed; recover them from git
  history if needed (`git log --diff-filter=D --name-only -- '*.md'`).
