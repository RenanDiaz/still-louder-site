# Deploy en Cloudflare (Workers)

Producción se mueve de Vercel a **Cloudflare Workers** y del dominio
`stilllouder.space` a **`still-louder.com`**. Cada app es un Worker
independiente, igual que en Vercel eran dos proyectos separados:

| App | Worker | Config | Dominio de producción |
|---|---|---|---|
| Main site | `still-louder-site` (solo assets estáticos) | `wrangler.jsonc` (raíz) | `still-louder.com` (+ `www` → 301 al apex) |
| Ticket system | `still-louder-tickets` (assets + API) | `ticket-system/wrangler.jsonc` | `entradas.still-louder.com` |

La configuración de Vercel queda intacta (sirve de **rollback**: ambos backends
usan la misma Supabase, así que volver a Vercel no parte los datos): `vercel.json` sigue aplicando en
Vercel y los archivos de Cloudflare (`wrangler.jsonc`, `_headers`,
`_redirects`) son ignorados por Vercel (los `_headers`/`_redirects` se sirven
como estáticos inertes). **Si cambias headers o rewrites, actualiza ambos
lados** — cada archivo indica su espejo.

## Requisitos

- Cuenta de Cloudflare y `npx wrangler login` (una vez por máquina).
- La zona DNS `still-louder.com` en esa misma cuenta de Cloudflare (automático
  si se compró en Cloudflare Registrar; si no, cambiar los nameservers en el
  registrador). Los `routes` con `custom_domain: true` de ambos
  `wrangler.jsonc` crean los registros DNS y certificados al deployar — si la
  zona no está en la cuenta, `wrangler deploy` falla con un error explícito.
  Las URLs `*.workers.dev` siguen activas (`workers_dev: true`) para probar.

**Pasos de migración en orden: ver [Cutover a still-louder.com](#cutover-a-still-loudercom) al final.**

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
- Dominios: `still-louder.com` y `www.still-louder.com` (bloque `routes`).

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
- Dominio: `entradas.still-louder.com` (bloque `routes`).
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

---

## Cutover a still-louder.com

Orden pensado para que **Vercel siga vendiendo hasta el último paso**: nada de
lo de abajo toca Vercel ni `stilllouder.space` hasta el paso 7. Hacerlo
**antes de abrir la preventa**, no el mismo día.

### 1. Deploy de los dos Workers

```bash
npx wrangler login
npm install && npm run deploy:cloudflare                          # main site
cd ticket-system && npm install && npm run deploy:cloudflare      # tickets
```

Verificar que `https://still-louder.com`, `https://www.still-louder.com` y
`https://entradas.still-louder.com` responden (el certificado puede tardar
unos minutos la primera vez).

### 2. Secrets del ticket system

Copiar **los mismos valores** de Vercel (Project → Settings → Environment
Variables → Production) con `wrangler secret put` (lista completa arriba),
**excepto** estos dos, que cambian con el dominio:

```
PUBLIC_BASE_URL=https://entradas.still-louder.com
YAPPY_BTN_DOMAIN=https://entradas.still-louder.com
```

`npx wrangler secret list` para confirmar que no falta ninguno. Un secret
requerido faltante hace que toda la API responda `500 internal_error`.

### 3. Yappy (el paso de mayor riesgo — hacerlo primero en el calendario)

En Yappy Comercial → Botón de Pago, cambiar el dominio/URL del comercio a
`https://entradas.still-louder.com`. Si el portal no deja editarlo o requiere
aprobación de Banco General, **ese es el camino crítico**: mientras no esté
aprobado, Yappy rechazará órdenes del dominio nuevo. La URL del IPN no se
registra en el portal: el backend la manda en cada orden
(`${PUBLIC_BASE_URL}/api/yappy/ipn`).

Plan B si Yappy no aprueba a tiempo: vender con Tarjeta (CuantoApp) + Efectivo
en el dominio nuevo y habilitar Yappy cuando se apruebe (quitar
`YAPPY_BTN_MERCHANT_ID` lo deshabilita limpiamente), o mantener la venta en
Vercel/`entradas.stilllouder.space` hasta que se apruebe.

### 4. Correo (Resend)

`EMAIL_FROM` sigue siendo `entradas@stilllouder.space` (dominio ya verificado
en Resend) — **no cambiarlo** en el cutover. Pasar a
`entradas@still-louder.com` es un paso aparte: agregar el dominio en Resend,
crear en Cloudflare DNS los registros SPF/DKIM que indique, esperar
"Verified" y recién ahí cambiar el secret. Mientras se use el remitente viejo,
**no borrar** los registros DNS de Resend de `stilllouder.space`.

### 5. Smoke test en producción (Cloudflare)

- `/entradas`, `/31-10`, `/ayuda`, `/admin`, `/validar`, `/support` cargan.
- `GET /api/presale/status` → 200 con datos reales (prueba Supabase + secrets).
- Login en `/admin` y `/validar` (prueba `ADMIN_PASSWORD`/`STAFF_PASSWORD`).
- Una compra real de $1 por Yappy → IPN → correo con QR → QR pasa en
  `/validar` una vez → reversa. Esto valida HMAC, Resend, Yappy y el dominio
  de punta a punta.
- `/admin` → reenviar correo de una orden: el enlace del QR apunta a
  `entradas.still-louder.com`.
- Cron: dashboard → Workers → `still-louder-tickets` → Settings → Triggers
  muestra `0 6 * * *`; al día siguiente, Logs muestra la corrida sin
  `[cron] ... failed`.

### 6. Enlaces del sitio y material

Este repo ya apunta todo a `still-louder.com` (canonical, OG, sitemap,
`config.js`, enlaces a entradas). Mergear a `main` **después** del paso 5
(el merge redeploya Vercel con canonicals al dominio nuevo). Actualizar bio de
Instagram/Facebook/Linktree y cualquier QR impreso.

### 7. Dominio viejo → 301 al nuevo

Lo más simple con la zona `stilllouder.space` también en Cloudflare
(Add a site → cambiar nameservers en el registrador; importar los registros
existentes, **incluidos los de Resend**). Luego, en Rules → Redirect Rules de
la zona vieja, dos reglas (dynamic, 301, preserve query string):

| Si hostname es | Redirigir a |
|---|---|
| `entradas.stilllouder.space` | `concat("https://entradas.still-louder.com", http.request.uri.path)` |
| `stilllouder.space` o `www.stilllouder.space` | `concat("https://still-louder.com", http.request.uri.path)` |

Los hostnames necesitan un registro DNS proxied (naranja) para que la regla
aplique: un `AAAA 100::` proxied por cada uno basta. Y en la zona nueva, una
regla `www.still-louder.com` → `concat("https://still-louder.com", http.request.uri.path)`.

Con esto, los enlaces viejos (posts, QR del sitio, `/31-10` del teaser)
siguen funcionando. Después de verificar, quitar los dominios de los
proyectos de Vercel; no borrar los proyectos hasta pasado el evento
(rollback).

### Rollback

Volver a apuntar los enlaces/DNS a Vercel. Las órdenes creadas en Cloudflare
viven en la misma Supabase, así que el admin de Vercel las ve. Lo único a
revisar: órdenes Yappy creadas en Cloudflare tienen el IPN en el dominio
nuevo — dejar el Worker vivo hasta que no queden pendientes (15 min).
