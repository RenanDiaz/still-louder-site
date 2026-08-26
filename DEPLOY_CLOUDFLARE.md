# Deploy en Cloudflare (Workers)

Este repo puede deployarse en **Cloudflare Workers** además de (o en lugar de)
Vercel. Cada app es un Worker independiente, igual que hoy son dos proyectos
separados de Vercel:

| App | Worker | Config | Dominio de producción |
|---|---|---|---|
| Main site | `still-louder-site` (solo assets estáticos) | `wrangler.jsonc` (raíz) | `stilllouder.space` |
| Ticket system | `still-louder-tickets` (assets + API) | `ticket-system/wrangler.jsonc` | `entradas.stilllouder.space` |

La configuración de Vercel queda intacta: `vercel.json` sigue aplicando en
Vercel y los archivos de Cloudflare (`wrangler.jsonc`, `_headers`,
`_redirects`) son ignorados por Vercel (los `_headers`/`_redirects` se sirven
como estáticos inertes). **Si cambias headers o rewrites, actualiza ambos
lados** — cada archivo indica su espejo.

## Requisitos

- Cuenta de Cloudflare y `npx wrangler login` (una vez por máquina).
- Para usar los dominios reales: la zona DNS `stilllouder.space` debe estar en
  esa cuenta de Cloudflare (nameservers apuntando a Cloudflare). Mientras
  tanto, todo funciona en las URLs `*.workers.dev`.

---

## Main site (raíz del repo)

Worker de **solo assets**: no hay código de servidor, `dist/` se sirve directo.

```bash
npm install
npm run preview:cloudflare   # build + wrangler dev (prueba local)
npm run deploy:cloudflare    # build + wrangler deploy
```

- Los headers de seguridad y caching de `vercel.json` viven en
  `public/assets/_headers` (Vite copia `public/assets/` → raíz de `dist/`, que
  es donde Cloudflare espera `_headers`).
- `cleanUrls` se replica con `assets.html_handling: "auto-trailing-slash"`.
- Dominio: descomentar el bloque `routes` en `wrangler.jsonc` cuando la zona
  esté en Cloudflare.

## Ticket system (`ticket-system/`)

Un solo Worker sirve el build de Vite (assets) y **la misma API estilo Vercel
sin reescribirla**: `cloudflare/worker.ts` enruta `/api/*` hacia los handlers
existentes de `api/` a través del adaptador `cloudflare/vercel-adapter.ts`
(shim de `req`/`res`). Con `nodejs_compat`, `node:crypto`, `Buffer` y
`process.env` funcionan sin cambios en el código de `api/`.

```bash
cd ticket-system
npm install
npm run typecheck            # incluye tsconfig.cloudflare.json
npm run preview:cloudflare   # build + wrangler dev (frontend + API + cron local)
npm run deploy:cloudflare    # build + wrangler deploy
```

### Secrets (equivalente a las env vars de Vercel)

Todas las variables de `api/_lib/env.ts` se cargan como **secrets** del Worker
(nunca `vars` en el jsonc, que es público en el repo):

```bash
cd ticket-system
# Requeridas
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TICKET_HMAC_SECRET
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put STAFF_PASSWORD
npx wrangler secret put YAPPY_BTN_MERCHANT_ID
npx wrangler secret put YAPPY_BTN_SECRET_KEY
# Recomendadas / opcionales (mismas semánticas que en Vercel)
npx wrangler secret put CRON_SECRET            # sin esto el cron diario NO corre
npx wrangler secret put PUBLIC_BASE_URL        # debe ser el dominio que sirve el Worker
npx wrangler secret put YAPPY_BTN_ENV
npx wrangler secret put YAPPY_BTN_DOMAIN
npx wrangler secret put YAPPY_BTN_CDN_URL        # override del CDN del web component
npx wrangler secret put EMAIL_FROM
npx wrangler secret put EMAIL_REPLY_TO
npx wrangler secret put ORDER_NOTIFICATION_EMAIL
npx wrangler secret put SUPPORT_PASSWORD
npx wrangler secret put CUANTOAPP_PAYMENT_URL    # sin esto la opción CuantoApp queda sin link
npx wrangler secret put CUANTOAPP_PAYMENT_URL_1  # ... _2 .. _10: un link por cantidad
npx wrangler secret put YAPPY_API_KEY
npx wrangler secret put YAPPY_API_SECRET_KEY
npx wrangler secret put YAPPY_API_SEED
npx wrangler secret put YAPPY_API_CHANNEL
npx wrangler secret put YAPPY_API_BASE
# Google Wallet (opt-in, fase 3)
npx wrangler secret put GOOGLE_WALLET_ISSUER_ID
npx wrangler secret put GOOGLE_WALLET_SA_EMAIL
npx wrangler secret put GOOGLE_WALLET_SA_PRIVATE_KEY
npx wrangler secret put GOOGLE_WALLET_CLASS_SUFFIX
```

Para desarrollo local, `wrangler dev` lee un archivo `ticket-system/.dev.vars`
(formato `NOMBRE=valor`, gitignorado).

### Piezas que replican vercel.json

| En Vercel | En Cloudflare |
|---|---|
| Rewrite `/api/admin/:path*` → `?path=` | Router en `cloudflare/worker.ts` (pasa `path` como param) |
| Rewrites `/when-we-were-young-3`, `/regalo/:token` | `public/_redirects` (rewrites 200) |
| Headers (CSP, `X-Robots-Tag` de `/regalo`) | `public/_headers` (assets) + adaptador (`/api/*`: `no-store` + CSP/HSTS/`X-Frame-Options`/`nosniff`) |
| Cron diario `orders/cleanup` | `triggers.crons` + handler `scheduled()` (manda `Authorization: Bearer CRON_SECRET`, mismo contrato que Vercel Cron) |
| `cleanUrls` | `assets.html_handling: "auto-trailing-slash"` |
| Límite de 12 funciones (Hobby) | No aplica: es un solo Worker |

### Cosas a tener en cuenta

- **Cada archivo nuevo bajo `api/` hay que registrarlo también en el router de
  `cloudflare/worker.ts`** — en Cloudflare no hay ruteo por filesystem.
- El alias `qrcode → qrcode/lib/index.js` en `wrangler.jsonc` es necesario: sin
  él el bundler usa el build de browser de `qrcode` (renderiza con `<canvas>`)
  y `toBuffer()` no existe. Verificado: el PNG del QR se genera bien en el
  runtime de Workers.
- Al mover producción: actualizar `PUBLIC_BASE_URL`/`YAPPY_BTN_DOMAIN` y el
  dominio registrado en el portal de Yappy si cambia el dominio que sirve; la
  URL del IPN la deriva el backend de `PUBLIC_BASE_URL`.
- Dominio: descomentar `routes` en `ticket-system/wrangler.jsonc` cuando la
  zona esté en Cloudflare.
- CI opcional: conectar el repo con **Workers Builds** (dashboard → Workers →
  Create → connect repo), un proyecto por app, con root directory `/` y
  `ticket-system/` respectivamente; build `npm install && npm run build`,
  deploy `npx wrangler deploy`.

### Smoke test local

```bash
cd ticket-system
cat > .dev.vars <<'EOF'
TICKET_HMAC_SECRET=un-secreto-local
ADMIN_PASSWORD=admin-local
STAFF_PASSWORD=staff-local
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role>
RESEND_API_KEY=<resend>
YAPPY_BTN_MERCHANT_ID=<merchant>
YAPPY_BTN_SECRET_KEY=<base64>
CRON_SECRET=cron-local
EOF
npm run preview:cloudflare
# El cron se prueba, con `wrangler dev` ya corriendo, con:
#   curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```
