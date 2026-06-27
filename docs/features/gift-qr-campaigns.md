# Campañas de entradas de regalo vía QR oculto

> Subsistema: `ticket-system/`. Esta feature vive en la app de tickets (React +
> TS + Vercel Functions + Supabase), **no** en el sitio principal.

## Contexto

Mecánica de marketing: un **QR oculto** (impreso/proyectado) lleva a una **URL
secreta** `/regalo/<token>`. Las primeras **N** personas que completen el
formulario reciben una **entrada de regalo**. `N` se define al crear la campaña
en el panel admin.

El regalo **no es una cortesía**: es un tipo nuevo (`tier = 'regalo'`,
`payment_method = 'gift'`) diferenciado en datos para reportes y auditoría.
Reutiliza el mismo pipeline de emisión que todo lo demás (orden $0 → `issueOrder`
→ QR firmado HMAC + email Resend + Google Wallet), igual que la cortesía.

## Decisiones acordadas

| Decisión | Resolución |
|---|---|
| Campos del formulario | nombre + email (obligatorios) + teléfono (opcional) |
| Cupo | **independiente**: el regalo NO cuenta contra el cupo de preventa; solo lo limita su propio `N` |
| Un reclamo por email | sí, `unique(campaign_id, lower(email))`, sin verificación de email |
| Expiración por tiempo | no; la campaña cierra solo al agotar `N` o por cierre manual |
| Atadura a evento | sistema mono-evento (WWWY3 hardcodeado): la campaña no lleva `event_id` |
| Token de campaña | secreto plano aleatorio (32 bytes, base64url); **no** firmado HMAC — la seguridad es la inadivinabilidad |
| QR de la campaña | codifica la URL; se genera server-side como data URL (reusa `qrcode`) |

## Modelo de datos (`supabase/migrations/0008_gift_campaigns.sql`)

Enums extendidos: `orders.tier`/`tickets.tier` += `'regalo'`,
`orders.payment_method` += `'gift'`.

```
gift_campaign
  id            uuid pk
  token         text unique        -- aleatorio, largo, no secuencial
  max_gifts     int   (> 0)        -- N
  claimed_count int   default 0
  status        text  (active | exhausted | closed)
  created_at    timestamptz

gift_claim
  id          uuid pk
  campaign_id fk -> gift_campaign (on delete cascade)
  name        text
  email       text
  phone       text
  order_id    fk -> orders (on delete set null)  -- la entrada $0 emitida
  claimer_ip  text                               -- auditoría + throttle suave
  created_at  timestamptz
  unique(campaign_id, lower(email))
```

Ambas tablas con RLS habilitado y sin policies (solo service-role accede).

### RPC atómico `claim_gift(p_token, p_name, p_email, p_phone, p_ip)`

Corazón race-safe. Bajo `FOR UPDATE` sobre la fila de la campaña (serializa los
reclamos concurrentes de esa campaña):

1. Si el token no existe → `not_found`.
2. Si `status <> 'active'` → devuelve el estado (`exhausted` | `closed`).
3. Si el email ya reclamó en esta campaña → `already_claimed` (**no** consume cupo).
4. Reserva atómica:
   `UPDATE gift_campaign SET claimed_count = claimed_count + 1,
    status = CASE WHEN claimed_count + 1 >= max_gifts THEN 'exhausted' ELSE 'active' END
    WHERE id = :id AND status = 'active' AND claimed_count < max_gifts RETURNING *`.
   Si no afecta filas → `exhausted` (otro reclamo tomó el último cupo).
5. Solo si reservó: inserta la orden $0 `regalo`/`gift` en `pending` + la fila
   `gift_claim`, y devuelve `claimed` + `order_id`.

Garantiza **N exacto**: jamás se emite N+1. `regalo`/`gift` no aparecen en
`create_order`/`presale_status`, así que el regalo no toca el cupo de preventa.

## Endpoints

### Público — `api/gifts.ts` (1 función serverless nueva; sin auth)

- `GET /api/gifts?token=...` → `{ status: 'active' | 'exhausted' | 'closed' }`.
  Token inexistente/ausente → **404 neutro** (no filtra existencia). Nunca expone
  `claimed_count`/`max_gifts`.
- `POST /api/gifts` body `{ token, name, email, phone? }` (PII solo en el body):
  valida; **throttle suave por IP** (máx 5 reclamos/min, conteo en `gift_claim`);
  llama `claim_gift`; si `claimed`, ejecuta `issueOrder(order_id)`. Devuelve
  `201 { status:'claimed', emailed }` o un `4xx` con código en `error`
  (`exhausted` | `closed` | `already_claimed` | `not_found` | `rate_limited`).

### Admin — dentro de `api/admin.ts` (gated por `isAdmin`)

- `POST /api/admin/gifts` `{ max_gifts }` → crea campaña; devuelve
  `{ campaign, url, qrDataUrl }` (token vía `crypto.randomBytes(32).base64url`).
- `GET  /api/admin/gifts` → lista campañas + métricas (`claimed_count`/`max_gifts`, estado).
- `GET  /api/admin/gifts/:id` → detalle + `{ url, qrDataUrl, claims[] }`.
- `POST /api/admin/gifts/:id/close` → cierre manual (active → closed).

> Conteo de funciones serverless: se pasó de 10 a **11** (límite Hobby = 12).
> Solo `api/gifts.ts` es nueva; las rutas admin comparten `api/admin.ts`.

## Superficie pública oculta — `/regalo/<token>`

- `regalo.html` (entry Vite) con `<meta name="robots" content="noindex,nofollow">`.
- `vercel.json`: rewrite `/regalo/:token` → `/regalo` y header
  `X-Robots-Tag: noindex, nofollow` para `/regalo(.*)`. CSP sin cambios (la
  página solo llama same-origin `/api/gifts`).
- `src/regalo/App.tsx`: lee el token de `location.pathname` (no query string);
  estados: cargando → formulario / agotada / no encontrada (neutra) → reclamado /
  ya reclamado. Reusa el tema público `src/entradas/theme.css`.

## Panel admin

Nuevo tab **Regalos** (`src/admin/App.tsx` → `RegalosTab`): crear campaña (N),
ver/descargar QR + copiar URL, tabla de campañas con métricas y botón "Cerrar",
y por campaña la lista de reclamos (nombre, correo, teléfono, timestamp).

## Emisión / email

`api/_lib/issue.ts` se reutiliza sin cambios. `api/_lib/email.ts` y
`src/shared/config.ts` agregan la etiqueta `regalo: 'Regalo'`; el correo usa una
variante de copy para `payment_method === 'gift'` ("¡te ganaste esta entrada de
regalo!"). El QR firmado HMAC y Google Wallet operan sobre el ticket, sin cambios.

## Seguridad

- Token criptográficamente aleatorio (256 bits), no secuencial, no adivinable.
- URL oculta: `noindex` (meta + `X-Robots-Tag`), no enlazada desde el sitio.
- Token inválido → 404 neutro, sin revelar la existencia de campañas.
- PII (nombre/email/teléfono) solo en el body del `POST`, nunca en query string.
- Throttle suave por IP en el endpoint público.
- Un reclamo por email por campaña (índice único + verificación en el RPC).

## Verificación end-to-end

1. `cd ticket-system && npm run typecheck && npm run build`.
2. Aplicar `0008_gift_campaigns.sql` en Supabase. Con `vercel dev`:
   - Admin → Regalos → crear campaña N=2 → ver QR/URL.
   - `/regalo/<token>` → reclamar email A → llega correo con ticket **tier `regalo`**
     y QR válido en `/validar`.
   - Reclamar email B → 2/2, campaña pasa a `exhausted`.
   - Reclamar email C → copy "ya se agotaron" (sin error feo); confirmar que no se
     creó orden (N exacto).
   - Reintentar email A → `already_claimed`, sin consumir cupo.
   - `/regalo/token-basura` → pantalla neutra / 404.
   - Verificar que el cupo de preventa de `/entradas` no cambió.
