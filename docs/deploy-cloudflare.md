# Deploy en Cloudflare (Workers)

Las dos apps corren **solo en Cloudflare Workers** (Vercel quedó retirado) en
**`still-louder.com`**. Cada app es un Worker independiente:

| App | Worker | Config | Dominio de producción |
|---|---|---|---|
| Main site | `still-louder-site` (solo assets estáticos) | `wrangler.jsonc` (raíz) | `still-louder.com` (+ `www` → 301 al apex) |
| Ticket system | `still-louder-tickets` (assets + API) | `ticket-system/wrangler.jsonc` | `entradas.still-louder.com` |

Headers y rewrites viven solo en los archivos de Cloudflare: `_headers`,
`_redirects` y, para `/api/*` del ticket system, `cloudflare/adapter.ts`.

## Requisitos

- Cuenta de Cloudflare y `npx wrangler login` (una vez por máquina).
- La zona DNS `still-louder.com` en esa misma cuenta de Cloudflare (automático
  si se compró en Cloudflare Registrar; si no, cambiar los nameservers en el
  registrador). Los `routes` con `custom_domain: true` de ambos
  `wrangler.jsonc` crean los registros DNS y certificados al deployar — si la
  zona no está en la cuenta, `wrangler deploy` falla con un error explícito.
  Las URLs `*.workers.dev` siguen activas (`workers_dev: true`) para probar.

---

## Main site (raíz del repo)

Worker de **solo assets**: no hay código de servidor, `dist/` se sirve directo.

```bash
npm install
npm run preview:cloudflare   # build + wrangler dev (prueba local)
npm run deploy:cloudflare    # build + wrangler deploy
```

Sin secrets, así que el problema de la cadena de secrets del ticket system no
aplica aquí.

- Los headers de seguridad y caching viven en `public/assets/_headers` (Vite
  copia `public/assets/` → raíz de `dist/`, que es donde Cloudflare espera
  `_headers`).
- URLs sin `.html` con `assets.html_handling: "auto-trailing-slash"`.
- Dominios: `still-louder.com` y `www.still-louder.com` (bloque `routes`).

## Ticket system (`ticket-system/`)

Un solo Worker sirve el build de Vite (assets) y la API: `cloudflare/worker.ts`
enruta `/api/*` hacia los handlers de `api/` a través de `cloudflare/adapter.ts`,
que arma el par `req`/`res` estilo Node (`ApiRequest`/`ApiResponse` en
`api/_lib/http.ts`) a partir del `Request` del Worker. Con `nodejs_compat`,
`node:crypto`, `Buffer` y `process.env` funcionan en `api/`.

```bash
cd ticket-system
npm install
npm run typecheck            # incluye tsconfig.cloudflare.json
npm run preview:cloudflare   # build + wrangler dev (frontend + API + cron local)
npm run release:cloudflare   # build + release con verificación (ver "Releases seguros")
npm run upload:cloudflare    # igual, pero sin promover: sube y verifica nada más
```

`deploy:cloudflare` es un alias de `release:cloudflare`: en el ticket system
nada sale a producción con `wrangler deploy` a secas.

### Variables de entorno: `vars` vs. secrets

Las variables se reparten en dos lugares del Worker. `process.env` ve ambas
por igual (`nodejs_compat`):

- **`vars` en `wrangler.jsonc`**: solo valores **no sensibles** que dependen
  del dominio o del entorno. Quedan versionadas junto al bloque `routes`, y
  así no se desincronizan del host que sirve el Worker. El jsonc es público
  en el repo: nada que sea credencial va aquí.
- **Secrets** (`wrangler secret put`): todo lo demás.

Un mismo nombre **no puede** ser var y secret a la vez: el deploy falla. Si ya
existía como secret, bórralo antes (`npx wrangler secret delete <NOMBRE>`).

#### `vars` (en `ticket-system/wrangler.jsonc`)

| Variable | Valor | Nota |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://entradas.still-louder.com` | El backend deriva de aquí la URL del IPN de Yappy y los enlaces del correo. |
| `SUPABASE_URL` | `https://ymvygyvidzxtwobpmral.supabase.co` | URL pública del proyecto; la credencial es `SUPABASE_SERVICE_ROLE_KEY` (secret). |
| `EMAIL_FROM` | `Still Louder <entradas@still-louder.com>` | Dominio verificado en Resend. |
| `EMAIL_REPLY_TO` | `stilllouder.pa@gmail.com` | Sin esto el correo no invita a responder. |
| `YAPPY_BTN_DOMAIN` | `https://entradas.still-louder.com` | Tiene que coincidir con el dominio registrado en el portal de Yappy. |
| `YAPPY_BTN_ENV` | `prod` | Sin esto el default es `test` (sandbox). |
| `YAPPY_BTN_MERCHANT_ID` | id del comercio | Identificador, no credencial (la credencial es `YAPPY_BTN_SECRET_KEY`). |
| `YAPPY_API_BASE` | `https://api-integration-business.yappy.cloud/v1` | Host de la API de reversos. |
| `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_EMAIL` | — | La credencial es `GOOGLE_WALLET_SA_PRIVATE_KEY` (secret). |
| `CUANTOAPP_PAYMENT_URL_1..10` | links de CuantoApp | Un producto oculto por cantidad; cambiar los links = commit + deploy. |

**`"keep_vars": true` en `wrangler.jsonc`**: las vars de texto agregadas en el
dashboard sobreviven a un deploy, pero las del archivo siguen ganando. Toda var
se cambia en `wrangler.jsonc`, no en el dashboard. Una var que se quite del
archivo sigue en el Worker hasta borrarla en el dashboard. (En wrangler ≤ 4.142,
`wrangler deploy` además solo heredaba los secrets con `keep_vars`; las
versiones nuevas los heredan siempre. Igual no alcanza: ver
[Releases seguros](#releases-seguros-versiones-y-secrets).)

Las variables de **Settings → Build → Variables** del dashboard solo existen
durante el build. El Worker no las ve en runtime y el ticket system no lee
ninguna en build, así que ahí no hacen nada.

`wrangler dev` también las aplica. Para no apuntar al Yappy de producción en
local, `.dev.vars` (que tiene prioridad sobre `vars`) debe definir
`YAPPY_BTN_ENV=test`.

#### Secrets

```bash
cd ticket-system
# Requeridas: si falta una, toda la API responde 500 internal_error
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TICKET_HMAC_SECRET     # openssl rand -hex 32 (ver nota abajo)
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put STAFF_PASSWORD
npx wrangler secret put YAPPY_BTN_SECRET_KEY
# Imprescindible en Cloudflare (en el código es opcional)
npx wrangler secret put CRON_SECRET            # openssl rand -hex 16; sin esto scheduled() se salta la limpieza
# Opcionales: activan una función, sin ellas no se rompe nada
npx wrangler secret put ORDER_NOTIFICATION_EMAIL # correos personales: secret para no publicarlos en el repo
npx wrangler secret put SUPPORT_PASSWORD         # sin esto solo ADMIN_PASSWORD entra a /support
# Reversos Yappy (sin key/secret/seed el reembolso queda como marca manual)
npx wrangler secret put YAPPY_API_KEY
npx wrangler secret put YAPPY_API_SECRET_KEY
npx wrangler secret put YAPPY_API_SEED
npx wrangler secret put YAPPY_API_CHANNEL        # default 'API' — confirmar con Yappy
npx wrangler secret put YAPPY_BTN_CDN_URL        # override del CDN del web component; solo si el default no carga
# Google Wallet (opt-in; sin la clave el botón no aparece)
npx wrangler secret put GOOGLE_WALLET_SA_PRIVATE_KEY   # pegar con los 
 escapados (el código los convierte)
# GA4 (opt-in; sin esto el servidor no manda el `purchase`) — docs/features/analytics-entradas.md
npx wrangler secret put GA_MP_API_SECRET
```

Para cargar muchas de una vez: `npx wrangler secret bulk secrets.json` (un
objeto `{ "NOMBRE": "valor" }`; borrar el archivo después, nunca commitearlo).

Notas:

- **`TICKET_HMAC_SECRET`**: son 32 bytes aleatorios y no se derivan de nada.
  Es uno solo para todos los eventos, así que rotarlo invalida el QR de
  **toda** entrada ya emitida: los correos enviados y los pases de Google
  Wallet. El QR no se guarda en la BD, así que reenviar el correo lo regenera
  con la firma nueva. Solo rotarlo cuando no haya entradas vivas de ningún
  evento, o asumiendo que hay que reenviar todos los correos.
- **CuantoApp**: el código usa `||`, así que un `CUANTOAPP_PAYMENT_URL_<n>`
  definido **vacío** cae al fallback `CUANTOAPP_PAYMENT_URL` (o a ningún link,
  si ese también está vacío). Después de cada deploy, revisar la pestaña
  **CuantoApp** del admin: marca faltantes, fallbacks y links duplicados.
- **Variables obsoletas** (no crearlas aunque aparezcan en notas viejas): ningún
  código las lee. `VENUE_ADDRESS` y `EVENT_START_ISO` hoy viven en la tabla
  `events`. `GOOGLE_WALLET_CLASS_SUFFIX` se retiró: la clase es
  `${issuerId}.${events.code}` en minúscula. `YAPPY_MERCHANT_ID` y
  `YAPPY_SECRET_KEY` son de una integración anterior; hoy se usan
  `YAPPY_BTN_*` y `YAPPY_API_*`.

Para desarrollo local, `wrangler dev` lee `ticket-system/.dev.vars`
(formato `NOMBRE=valor`, gitignorado).

### Releases seguros (versiones y secrets)

Cada upload (`wrangler deploy`, `wrangler versions upload`, Workers Builds)
crea una **versión** del Worker que copia los secrets de la **última versión
subida**, no de la activa. Basta una versión sin secrets para romper la
cadena: todas las siguientes salen sin secrets aunque el código y las vars
estén bien, y la API responde 500. Un rollback no lo arregla, porque solo
cambia la versión activa.

Pasó el 1 y el 2-oct-2026: un build de rama de Workers Builds subió una versión
vacía (`ceff0208`) y desde ahí todas las versiones salieron sin los 13 secrets,
incluida la del merge de #82, que hubo que revertir en plena venta.

Volvió a pasar el 2-oct con el merge de #84: los 4 pushes de la rama del PR
(builds de rama todavía activos) dejaron la cadena vacía y `wrangler deploy`
de Workers Builds la promovió directo a producción.

**Cómo liberar**: `scripts/release-cloudflare.mjs`, nunca `wrangler deploy`.

```bash
cd ticket-system
npm run release:cloudflare           # build + upload + verificación + promoción
npm run upload:cloudflare            # lo mismo sin promover (imprime el comando para hacerlo)
```

El script:

1. Sube una versión con 0% de tráfico (`wrangler versions upload`).
2. **No la promueve** si le falta un secret requerido (`REQUIRED_SECRETS` en
   el script: los `required()` de `api/_lib/env.ts` + `CRON_SECRET`) o
   cualquier secret que tenga la versión activa. Producción no se toca.
3. Hace smoke test de `/api/presale/status` en la Preview URL (200 o 404
   `event_not_found` = llegó a Supabase; sin secrets responde 500).
4. La promueve al 100%, repite el smoke test contra producción y, si falla,
   vuelve a poner el deployment anterior.

Si se agrega un secret requerido nuevo, sumarlo a `REQUIRED_SECRETS`.

Si falla en el paso 2, la versión rechazada igual queda como la última
subida y la siguiente hereda sus secrets (ninguno): hay que recuperar la
cadena con `--secrets-file` (abajo).

**Configuración del proyecto en Workers Builds** (`still-louder-tickets`):

- Build command: `npm ci && npm run build`.
- Deploy command: `node scripts/release-cloudflare.mjs`. Un push a `main`
  sale a producción solo si pasa la verificación; si no, el build falla y
  producción queda como estaba. **Nunca** `npx wrangler deploy`.
- Branch control: builds de ramas que no son `main` **desactivados**. Cada
  push de rama sube una versión al mismo Worker y es la forma más fácil de
  romper la cadena.
- `package-lock.json` está commiteado: el build instala siempre la misma
  wrangler. Actualizarla es un commit (`npm install -D wrangler@<versión>`).

**Recuperar la cadena** (la última versión no tiene secrets):

`wrangler secret put` falla con "the latest version of your Worker isn't
currently deployed" después de un rollback, y `wrangler versions secret put`
parte de la última versión, que es la rota. Lo que sí funciona es subir una
versión con **todos** los secrets en archivo:

```bash
cd ticket-system
# secrets.json = { "NOMBRE": "valor", ... } con TODOS los secrets (gitignorado; borrarlo al terminar)
npm run build && node scripts/release-cloudflare.mjs --secrets-file secrets.json
rm secrets.json
```

Los valores salen del gestor de contraseñas. `TICKET_HMAC_SECRET` tiene que ser
**exactamente** el mismo, o los QR emitidos dejan de validar. Si `CRON_SECRET`
no se recupera, sirve uno nuevo (`openssl rand -hex 16`): solo lo usa el cron
del propio Worker.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Ruteo de `/api/*` (incluye `/api/admin/:path*` → `api/admin.ts` con `path`) | Router en `cloudflare/worker.ts` |
| Rewrites `/when-we-were-young-3`, `/regalo/:token`; redirect `/31-10`, `/` | `public/_redirects` |
| Headers (CSP, `X-Robots-Tag` de `/regalo`) | `public/_headers` (assets) + `cloudflare/adapter.ts` (`/api/*`: `no-store` + CSP/HSTS/`X-Frame-Options`/`nosniff`) |
| Cron diario `orders/cleanup` | `triggers.crons` + handler `scheduled()` (manda `Authorization: Bearer CRON_SECRET`) |
| URLs sin `.html` | `assets.html_handling: "auto-trailing-slash"` |

### Cosas a tener en cuenta

- **Cada archivo nuevo bajo `api/` hay que registrarlo también en el router de
  `cloudflare/worker.ts`** — en Cloudflare no hay ruteo por filesystem.
- El alias `qrcode → qrcode/lib/index.js` en `wrangler.jsonc` es necesario: sin
  él el bundler usa el build de browser de `qrcode` (renderiza con `<canvas>`)
  y `toBuffer()` no existe. Verificado: el PNG del QR se genera bien en el
  runtime de Workers.
- Si cambia el dominio que sirve el Worker: actualizar `routes` **y** las
  `vars` `PUBLIC_BASE_URL`/`YAPPY_BTN_DOMAIN` en `wrangler.jsonc` en el mismo
  commit, y el dominio registrado en el portal de Yappy. La URL del IPN la
  deriva el backend de `PUBLIC_BASE_URL`.
- Dominio: `entradas.still-louder.com` (bloque `routes`).
- CI opcional: conectar el repo con **Workers Builds** (dashboard → Workers →
  Create → connect repo), un proyecto por app, con root directory `/` y
  `ticket-system/` respectivamente; build `npm install && npm run build`.
  Deploy `npx wrangler deploy` en el sitio principal; en el ticket system,
  `node scripts/release-cloudflare.mjs` con los builds de ramas desactivados (ver
  [Releases seguros](#releases-seguros-versiones-y-secrets)).

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
YAPPY_BTN_ENV=test
PUBLIC_BASE_URL=http://127.0.0.1:8787
YAPPY_BTN_DOMAIN=http://127.0.0.1:8787
EOF
npm run preview:cloudflare
# El cron se prueba, con `wrangler dev` ya corriendo, con:
#   curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

---

## Dominio viejo (`stilllouder.space`)

El cutover a `still-louder.com` está hecho. La zona `stilllouder.space` sigue en
Cloudflare solo para redirigir enlaces viejos (posts, QR impresos, `/31-10` del
teaser), con dos Redirect Rules (dynamic, 301, preserve query string):

| Si hostname es | Redirigir a |
|---|---|
| `entradas.stilllouder.space` | `concat("https://entradas.still-louder.com", http.request.uri.path)` |
| `stilllouder.space` o `www.stilllouder.space` | `concat("https://still-louder.com", http.request.uri.path)` |

Cada hostname necesita un registro DNS proxied (naranja) para que la regla
aplique (un `AAAA 100::` basta). En la zona nueva, una regla
`www.still-louder.com` → `concat("https://still-louder.com", http.request.uri.path)`.
Mantener los registros DNS de Resend de `stilllouder.space` mientras haya
correos viejos en circulación.

## Rollback

Un deploy malo se revierte en Cloudflare: el script de release ya vuelve solo
al deployment anterior si falla el smoke test de producción, y a mano está
`npx wrangler rollback` (o dashboard → Workers → Deployments). Ojo: un rollback
no repara una cadena de secrets rota (ver
[Releases seguros](#releases-seguros-versiones-y-secrets)).
