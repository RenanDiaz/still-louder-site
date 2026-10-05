# Analytics en el sistema de entradas (GA4)

> Subsistema: `ticket-system/`. El main site ya mide con GA4 (`G-ZZ4XG8CD88`,
> `public/assets/js/analytics.js`) y ya registra el clic al CTA de entradas
> (`click_shows`, `data-shows-link`). Este spec cubre **solo** el lado de
> `entradas.still-louder.com`.

## Estado: implementado (5 oct 2026) — falta la puesta en marcha manual

Código implementado según este spec. Antes de que llegue el primer `purchase`
hay que seguir la [Guía de puesta en marcha](#guía-de-puesta-en-marcha) (migración,
secreto, GA4 Admin). Mientras tanto, el funnel del cliente funciona igual
y el servidor no envía nada.

Desviaciones deliberadas:

| Spec | Implementación | Por qué |
|---|---|---|
| Regex `^\d{6,12}\.\d{9,11}$` / `^\d{6,12}$` | `^\d{1,12}\.\d{1,12}$` / `^\d{1,20}$` (`api/_lib/ga.ts`) | La parte aleatoria del client_id puede tener menos de 6 dígitos. El regex solo debe filtrar basura, no adivinar el formato exacto. |
| `getGaIds()` con timeout de 1 s | Los ids se piden al cargar (máx. 5 s) y en el submit se esperan **≤ 500 ms** | Así un comprador con bloqueador no espera 1 s extra al comprar. |
| `page_view` automático del `config` | `send_page_view: false`; el `page_view` se manda a mano cuando carga el evento, **antes** de que se monte el formulario | Así lleva `event_slug`/`event_status`, y `view_item` sale después de él (no antes, como pasaría con un efecto de React). |
| `click_help` por canal (WhatsApp/Instagram/email) | Solo `channel: 'instagram'` | `/ayuda` hoy solo tiene el DM de Instagram como canal. |
| — | Nota de privacidad en `/ayuda` ("Usamos Google Analytics…") | Lo que se acordó en "Riesgos". |

## Problema

Hoy no sabemos qué pasa entre el clic en "Comprar entradas" del main site y una
orden pagada. El panel admin dice **cuántas** órdenes hay, pero no **cuánta
gente llegó, cuántos empezaron el formulario, cuántos abandonaron y en qué paso, ni de
dónde venían** (Instagram, `/links`, QR del flyer, WhatsApp). Con la venta del
31-10 abierta, queremos esos datos para decidir dónde poner la promoción.

## Objetivo / no-objetivos

**Objetivo:** el funnel de `/entradas` (y `/halloween-party`) en el mismo
GA4 del main site, desde la visita hasta el pago confirmado, atribuido a la
fuente de tráfico, **sin mandar datos personales a Google**.

**No-objetivos:**

- Reemplazar los reportes del admin. **La BD sigue siendo la fuente de verdad
  de ingresos**; GA4 sirve para medir tasas de conversión y atribución, no para
  contabilidad. Los números no van a cuadrar 1:1 (bloqueadores de anuncios).
- Medir las superficies de staff (`/admin`, `/validar`, `/support`).
- Medir `/regalo/<token>` (el token va en la URL; es un enlace secreto).
- Banner de cookies / consentimiento (ver "Riesgos").

## Decisiones

| Decisión | Resolución | Por qué |
|---|---|---|
| Propiedad | **La misma** de GA4 que el main site (`G-ZZ4XG8CD88`). Se distingue por `hostname`. | Un solo funnel main site → entradas. Una propiedad aparte no puede unir sesiones. |
| Cross-domain | **No hace falta linker.** `entradas.` es subdominio de `still-louder.com`; gtag con `cookie_domain: 'auto'` escribe `_ga` en `.still-louder.com` y los dos sitios comparten `client_id`. En GA4 Admin hay que agregar `still-louder.com` a **"Unwanted referrals"** para que la sesión conserve la fuente original (Instagram, etc.). | Rectifico lo que dije en el chat: cross-domain es para dominios distintos, no para subdominios. |
| Superficies medidas | Solo `entradas.html`, `halloween-party.html` y `ayuda.html`. **No** se toca `admin`, `validar`, `support`, `regalo`, `index` (el redirect). | Lo público y sin secretos en la URL. |
| Carga del tag | Desde un **módulo** (`src/shared/analytics.ts`) que inyecta `gtag/js`. **Sin `<script>` inline** en el HTML. | La CSP tiene `script-src 'self'` sin `'unsafe-inline'`; el snippet inline estándar quedaría bloqueado. No queremos aflojar la CSP con `'unsafe-inline'`. |
| Solo en producción | El módulo no carga nada si `location.hostname !== 'entradas.still-louder.com'` (localhost, `*.workers.dev`, previews). Con `?debug_mode=1` en prod activa `debug_mode` para DebugView. | No contaminar datos con dev/QA. |
| Measurement ID en cliente | Constante en `src/shared/config.ts`. | Es público (está en el HTML del main site); no es un secreto. |
| Evento `purchase` | Lo envía **el servidor** con el **Measurement Protocol** desde `issueOrder()` (`api/_lib/issue.ts`), no el navegador. | Yappy confirma por IPN de servidor a servidor, y efectivo/CuantoApp se confirman en el admin, horas después y desde otro navegador. Un `purchase` en cliente sería falso o no llegaría. Mantiene la invariante de emisión independiente del método de pago (un solo punto). |
| Atar el `purchase` al visitante | Al crear la orden el cliente manda `ga_client_id` y `ga_session_id` (leídos con `gtag('get', …)`). El servidor los **valida por formato** y los guarda en `orders`. El MP los usa. | Así el `purchase` cae en la sesión y fuente correctas aunque se confirme días después. No son montos: no rompe "server-authoritative pricing". |
| Orden sin `ga_client_id` (adblock, o la orden la creó el admin) | **No se manda `purchase`.** | El visitante tampoco tiene `page_view`; si mandáramos el `purchase` con un client_id inventado, inflaríamos la conversión. El ingreso real sale del admin. |
| Exactamente una vez | Columna `orders.ga_purchase_sent_at`; se reclama con `UPDATE … WHERE ga_purchase_sent_at IS NULL RETURNING` antes de enviar (mismo patrón que `validate_ticket`). `transaction_id = order.id` como respaldo (GA4 deduplica por `transaction_id`). | `issueOrder` se llama varias veces (reintento de IPN, re-marcar pagado, reenvío); no debe contar doble. |
| Qué órdenes cuentan | `payment_method IN ('yappy','cuantoapp','cash')`. Se excluyen `courtesy` y `gift`. | Las cortesías y regalos son de $0 y no las compra nadie desde el funnel. |
| Valor | `value = total_cents / 100` (lo que pagó el comprador, cargo por servicio incluido), `currency: 'USD'`; item = tarifa. | Es el monto real de la transacción. |
| Fallo del MP | Best-effort: `try/catch` y timeout de 2 s, `console.error`, **nunca** tumba ni demora la emisión/correo. No hay reintento. | Analytics no puede romper la venta. Si se pierde un evento no es grave. |
| Secreto del MP | `GA_MP_API_SECRET`, server-only, **opcional** (si falta, no se envía nada). **No** va en `REQUIRED_SECRETS` de `release-cloudflare.mjs`. | La API funciona sin él. El script ya protege contra perder un secreto existente ("MISSING vs. the live deployment"). Rectifico lo que dije en el chat. |
| Archivos bajo `api/` | **Cero archivos nuevos bajo `api/`.** El envío vive en `api/_lib/ga.ts`. | Nada que registrar en el router de `cloudflare/worker.ts`. |
| PII | Prohibido mandar a GA nombre, email, teléfono, `order_id` como parámetro libre o tokens de QR. `transaction_id` usa el UUID de la orden: no identifica a nadie fuera de nuestra BD. | Ley 81 de 2019 (Panamá) y los términos de GA4 (prohíben PII). |

## Eventos

Parámetro común en todos: `event_slug` (p. ej. `halloween-party`), puesto con
`gtag('set', { event_slug })` apenas se resuelve el evento.

| Evento | Dónde / cuándo | Parámetros |
|---|---|---|
| `page_view` (automático) | Al cargar `/entradas`, `/halloween-party`, `/ayuda`. Lo manda el `config` de gtag. | `event_slug`, `event_status` (`teaser`/`on_sale`/`archived`) |
| `view_item` | Se renderiza el formulario de compra (venta abierta). Una vez por carga. | `items: [{ item_id: <slug>-<tier>, item_name, price }]`, `currency` |
| `form_start` | Primer `focus`/`input` en cualquier campo del formulario. Una vez por carga. | — |
| `begin_checkout` | `POST /api/orders` respondió **201** (orden pendiente creada). | `payment_type` (`yappy`/`cuantoapp`/`cash`), `value`, `currency`, `items` (tier, quantity) |
| `checkout_error` | `POST /api/orders` falló. | `error_code` (el `error` de la API: `sold_out`, `presale_sold_out`, `sales_closed`, `invalid_email`, `network`…) |
| `add_payment_info` | Solo Yappy: el comprador abre el botón de Yappy (`YappyButton`). | `payment_type: 'yappy'` |
| `yappy_expired` | `YappyCheckout` entra en fase `expired`/`cancelled`. | — |
| `purchase` | **Servidor**, Measurement Protocol, en `issueOrder()` (ver Decisiones). | `transaction_id`, `value`, `currency`, `payment_type`, `event_slug`, `items` |
| `click_help` | En `/ayuda`, clic en un canal oficial de contacto (WhatsApp/Instagram/email). | `channel` |

En GA4 se marcan como **key events** `begin_checkout` y `purchase`. Un
**funnel exploration** queda `page_view (on_sale) → form_start → begin_checkout → purchase`,
segmentable por fuente/medio y por `payment_type`.

Dimensiones personalizadas (event scope) a registrar en GA4 Admin:
`event_slug`, `event_status`, `payment_type`, `error_code`, `channel`.

## Cambios

### Base de datos — `supabase/migrations/0014_ga_attribution.sql`

```sql
alter table orders
  add column ga_client_id text,
  add column ga_session_id text,
  add column ga_purchase_sent_at timestamptz;
```

Sin cambios a `create_order` (no le cambiamos la firma a la RPC): `api/orders.ts`
hace un `UPDATE orders SET ga_client_id, ga_session_id WHERE id = …` justo después
del RPC, best-effort como el correo de aviso. Si falla, la orden no se pierde,
solo queda sin atribución.

### Backend

- `api/_lib/env.ts`: `gaMeasurementId` (opcional, default `G-ZZ4XG8CD88`) y
  `gaMpApiSecret` (opcional).
- `api/_lib/ga.ts` (nuevo, solo server): `sendPurchase(order, event)`. Reclama
  `ga_purchase_sent_at` de forma atómica y hace `POST https://www.google-analytics.com/mp/collect?measurement_id=…&api_secret=…`
  con `client_id`, `events[0].params.session_id`, `engagement_time_msec: 1`
  (si no, GA no asocia el evento a la sesión), `AbortSignal.timeout(2000)`.
  No hace nada si: no hay secreto, no hay `ga_client_id`, el método está excluido
  o el claim ya está tomado.
- `api/_lib/issue.ts`: después de `mark_order_paid`, `await sendPurchase(...)`
  envuelto en `try/catch` y **antes** del correo, para que un correo lento no lo
  retrase. Se manda por cualquier camino de pago: admin, IPN de Yappy, CuantoApp.
- `api/orders.ts`: acepta `ga_client_id` (regex `^\d{1,12}\.\d{1,12}$`) y
  `ga_session_id` (`^\d{1,20}$`); si no cumplen el formato, se ignoran en silencio (nunca dan 400).
- Sin cambios en `cloudflare/worker.ts` ni en `REQUIRED_SECRETS`.

### Frontend

- `src/shared/analytics.ts` (nuevo): `initAnalytics()`, `track(name, params)`,
  `setEventContext(slug, status)`, `getGaIds(): Promise<{clientId, sessionId} | null>`
  (con timeout de 1 s; `null` si gtag no cargó). Todo es no-op fuera de producción
  o si el script fue bloqueado. Nunca lanza.
- `src/entradas/main.tsx` y `src/ayuda/main.tsx`: `initAnalytics()`.
- `src/entradas/App.tsx`: los eventos de la tabla; `createOrder` incluye los ids de GA.
- `src/shared/api.ts`: `CreateOrderInput` gana `ga_client_id?`, `ga_session_id?`.
- `src/shared/config.ts`: `GA_MEASUREMENT_ID`.

### CSP — `ticket-system/public/_headers`

Agregar (y nada más):

- `script-src`: `https://www.googletagmanager.com`
- `connect-src`: `https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com`
- `img-src`: `https://*.google-analytics.com https://www.googletagmanager.com`

Como estas cabeceras aplican a todas las rutas, el admin también queda con el
dominio permitido aunque no cargue el tag. Es aceptable: el permiso solo
autoriza un origen, no carga nada.

### GA4 Admin (manual)

Ver [Guía de puesta en marcha](#guía-de-puesta-en-marcha).

### Docs

- `ticket-system/README.md`: `GA_MP_API_SECRET` en la tabla de env vars (opcional).
- `CLAUDE.md` (sección Ticket System): una línea con "GA4 solo en superficies
  públicas, `purchase` por Measurement Protocol desde `issue.ts`".
- `docs/README.md`: entrada de este spec.

## Criterios de aceptación

1. En `entradas.still-louder.com/halloween-party`, con DebugView (`?debug_mode=1`),
   aparecen `page_view` con `event_slug=halloween-party`, `view_item` y
   `form_start` (una sola vez cada uno aunque se escriba en varios campos).
2. La cookie `_ga` del main site y la de entradas tienen el **mismo** `client_id`
   (dominio `.still-louder.com`). Una visita que entra por Instagram al main site
   y compra en entradas aparece en GA4 con fuente Instagram, no `still-louder.com / referral`.
3. Crear una orden en efectivo dispara `begin_checkout` con `payment_type=cash`;
   la fila en `orders` tiene `ga_client_id` y `ga_session_id`.
4. Marcarla pagada desde `/admin` (otro navegador) produce **un** `purchase` en
   GA4, con el `transaction_id` de la orden, el `value` correcto y atribuido a la
   sesión original. Re-marcarla, reenviar el correo o repetir el IPN **no**
   produce otro (`ga_purchase_sent_at` ya está puesto).
5. Un pago Yappy confirmado por IPN produce `purchase` con `payment_type=yappy`.
6. Cortesías (`/admin`) y regalos (`/regalo`) **no** producen `purchase`.
7. Sin `GA_MP_API_SECRET`, con la API de GA caída o con un timeout, la orden se
   marca pagada y el correo sale igual (sin error visible, solo `console.error`).
8. Con un bloqueador de anuncios, `/entradas` funciona igual: compra completa, sin
   errores en consola atribuibles a analytics, y la orden queda sin `ga_*`.
9. En `localhost` y `*.workers.dev` no se hace ninguna request a
   Google (pestaña Network).
10. `/admin`, `/validar`, `/support`, `/regalo/<token>` no hacen ninguna request a Google.
11. Ningún hit a GA (cliente ni MP) contiene nombre, email, teléfono ni token de QR
    (revisar los payloads en Network / en el log del MP en dev).
12. CSP: cero violaciones en consola en `/entradas` y `/ayuda`.
13. `npm run typecheck` y `npm run build` en `ticket-system/` pasan; el conteo de
    funciones bajo `api/` no cambia.

## Riesgos y preguntas abiertas

- **Consentimiento.** El main site ya carga GA4 sin banner; este spec mantiene ese
  mismo criterio. La Ley 81 pide base legal para tratar datos personales; las
  cookies de analytics con IP truncada (GA4 no guarda IP) están en una zona
  gris. Decidido (5 oct 2026): **sin** banner por ahora, y una línea
  de privacidad en `/ayuda` ("usamos Google Analytics para medir visitas; no compartimos tus
  datos de compra"). Si la banda quiere banner, que sea un spec aparte para los dos sitios
  (Consent Mode v2).
- **Dominio.** Confirmado (5 oct 2026): la venta se sirve en producción en
  `entradas.still-louder.com`. Si algún día cambia el host, hay que actualizar
  `PROD_HOST` en `src/shared/analytics.ts`.
- **Volumen.** Con ~230 entradas, los números son chicos: GA4 puede aplicar
  umbrales y ocultar filas en reportes con pocos usuarios. El funnel exploration
  sigue sirviendo; para cifras exactas, el admin.
- **`engagement_time_msec`/`session_id` en MP**: si la sesión original ya expiró
  (pago en efectivo días después), GA4 atribuye el `purchase` al usuario pero
  puede abrir una sesión nueva sin fuente. Aceptable; el atribuidor de GA4 a nivel usuario
  ("first user source") sigue funcionando.

## Guía de puesta en marcha

Pasos manuales, en este orden. Los pasos 1 y 2 tienen que estar hechos **antes**
de que llegue a producción el código de este spec: sin la migración, el
`UPDATE` de los ids de GA falla. No rompe nada (es best-effort), pero se pierde
la atribución de esas órdenes.

### 1. Migración en Supabase

1. Supabase → proyecto → **SQL Editor** → New query.
2. Pegar el contenido de `ticket-system/supabase/migrations/0014_ga_attribution.sql`
   y ejecutarlo (o `supabase db push` si usas la CLI).
3. Verificar: en **Table Editor → orders** aparecen las columnas `ga_client_id`,
   `ga_session_id` y `ga_purchase_sent_at` (todas vacías). La migración es
   idempotente (`add column if not exists`), así que se puede correr dos veces.

### 2. Crear el secreto del Measurement Protocol

1. [analytics.google.com](https://analytics.google.com) → propiedad de Still
   Louder (la de `G-ZZ4XG8CD88`) → **Admin** (engranaje, abajo a la izquierda).
2. **Data collection and modification → Data streams** → el stream web.
3. **Measurement Protocol API secrets** → aceptar los términos si los pide →
   **Create** → nickname `ticket-system` → copiar el **Secret value**.
4. Guardarlo en el servidor (producción en Cloudflare):
   ```bash
   cd ticket-system
   npx wrangler secret put GA_MP_API_SECRET   # pegar el valor
   ```
   `wrangler secret put` crea y despliega una versión nueva del Worker con el
   código actual más el secreto. Las versiones que después suba
   `npm run release:cloudflare` lo heredan. **No** hace falta agregarlo a
   `REQUIRED_SECRETS`: es opcional y, una vez cargado, el script ya protege
   contra perderlo ("MISSING vs. the live deployment").

### 3. Configurar GA4

Todo en **Admin** de la misma propiedad:

1. **Unwanted referrals**: Data streams → stream web → **Configure tag
   settings** → *Show more* → **List unwanted referrals** → condición
   *Referral domain contains* `still-louder.com` → Save. Sin esto, la compra
   aparece con fuente `still-louder.com / referral` en vez de Instagram, QR, etc.
2. **Dimensiones personalizadas**: Data display → **Custom definitions** →
   *Create custom dimension*, scope **Event**, una por fila (el nombre que se ve
   en los reportes puede ser cualquiera; el *Event parameter* tiene que ser
   exacto):

   | Dimension name | Event parameter |
   |---|---|
   | Evento (slug) | `event_slug` |
   | Estado del evento | `event_status` |
   | Método de pago | `payment_type` |
   | Error de checkout | `error_code` |
   | Canal de ayuda | `channel` |

   Las dimensiones solo aplican a los datos que llegan **después** de crearlas,
   así que conviene crearlas antes de que salga el deploy.
3. **Key events**: Data display → **Events**. `begin_checkout` y `purchase`
   aparecen en esta lista recién después de que llegue el primero. Para no
   esperar, ir a **Key events → New key event**, escribir `begin_checkout` →
   Save, y lo mismo con `purchase`.

### 4. Desplegar y verificar

1. Hacer merge del PR. El release del ticket system es `npm run release:cloudflare`
   (o Workers Builds); el main site no cambia.
2. Abrir `https://entradas.still-louder.com/halloween-party?debug_mode=1` y en GA4
   **Admin → DebugView** confirmar `page_view` (con `event_slug`), `view_item` y
   `form_start` al escribir en el formulario (criterio 1).
3. En DevTools → Application → Cookies, el `_ga` de `entradas.` y el de
   `still-louder.com` deben tener el mismo valor (criterio 2).
4. Compra de prueba **en efectivo**, desde la misma pestaña con `?debug_mode=1`
   → `begin_checkout` en DebugView. En Supabase, esa orden tiene `ga_client_id`.
5. Marcarla pagada en `/admin` → en Supabase se llena `ga_purchase_sent_at`.
   El `purchase` del Measurement Protocol **no** aparece en DebugView (no lleva
   `debug_mode`): se ve en **Reports → Realtime** en 1-2 minutos y en los
   reportes normales en 24-48 h.
6. Cancelarla/reembolsarla desde el admin como cualquier orden de prueba. GA4 no
   descuenta el `purchase` solo; para una prueba de $10-12 no vale la pena
   mandar un `refund`.

### 5. Ver el funnel

**Explore → Funnel exploration**, pasos:

1. `page_view` con `event_status = on_sale` (y `event_slug` = el show)
2. `form_start`
3. `begin_checkout`
4. `purchase`

Breakdown por **Session source / medium** (de dónde vienen) o por **Método de
pago**. `checkout_error` con breakdown por *Error de checkout* muestra qué rechaza
el servidor (agotado, correo inválido…).
