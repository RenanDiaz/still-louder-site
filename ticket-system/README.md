# WWWY3 — Sistema de Entradas (Still Louder)

Venta, emisión y validación de entradas para **When We Were Young 3** (Hops, 1 de
agosto). Construido como app autónoma (React + TypeScript + Vite) con backend en
**Vercel Serverless Functions** y base de datos **Supabase (Postgres)**. Esta es
la entrega **M1** (vendible sin Yappy) más la integración del **Botón de Pago
Yappy V2** (ver "Yappy — Botón de Pago V2").

> Se construyó como un proyecto independiente dentro del repo (`/ticket-system`)
> para no tocar el sitio estático existente. Se despliega como un **proyecto Vercel
> aparte** (sugerido: subdominio `entradas.stilllouder.space`). Ver "Despliegue".

## Superficies

| Ruta        | Quién        | Qué hace                                                        |
| ----------- | ------------ | --------------------------------------------------------------- |
| `/entradas` | Público      | Compra: formulario → crea orden → instrucciones de pago.        |
| `/admin`    | Admin        | Reportes, órdenes (pagar/cancelar/reenviar correo), entradas (anular/restaurar), cortesías, check-in en vivo, toggle Etapa 2, export CSV. |
| `/validar`  | Staff/puerta | Escáner de QR con resultado verde/rojo + sonido.                |
| `/support`  | Soporte      | **Solo lectura**: buscar órdenes por email/teléfono/nombre/# de orden, ver su estado y sus entradas, y reenviar el correo con el QR. Sin acceso a mutaciones (pagar, cancelar, anular, cortesías, Etapa 2) ni a las estadísticas de ventas. |

## Arquitectura

El sistema es **agnóstico al método de pago**. Lo que dispara la emisión de la
entrada (crear tickets + enviar correo) es **una orden pasando a `paid`**, sin
importar el origen del pago. Toda esa lógica vive en `api/_lib/issue.ts` y es la
única rutina que emite. Efectivo y CuantoApp la invocan vía el botón "marcar
pagado" del admin; Yappy (fase 2) la invocará desde su webhook. **No acoplar la
emisión a ningún proveedor.**

```
ticket-system/
├── api/                      # Vercel serverless functions (TypeScript)
│   ├── _lib/                 # lógica compartida (NUNCA llega al cliente)
│   │   ├── env.ts            # acceso validado a variables de entorno
│   │   ├── supabase.ts       # cliente service-role (bypass RLS)
│   │   ├── auth.ts           # gates admin/staff (comparación timing-safe)
│   │   ├── hmac.ts           # firma/verificación del token del QR
│   │   ├── qr.ts             # render del QR (PNG / data URL)
│   │   ├── email.ts          # envío con Resend
│   │   ├── pricing.ts        # precios por tier + ventana de reserva (server-side)
│   │   ├── issue.ts          # rutina de emisión (idempotente, agnóstica al pago)
│   │   └── yappy.ts          # adaptador Botón de Pago V2 (llamados server-side + hash IPN)
│   ├── orders.ts             # POST  /api/orders                (público)
│   ├── orders/[id]/status.ts # GET   /api/orders/:id/status      (público, polling)
│   ├── presale/status.ts     # GET   /api/presale/status         (público)
│   ├── tickets/validate.ts   # POST  /api/tickets/validate       (staff)
│   ├── tickets/qr.ts         # GET   /api/tickets/qr?t=<token>   (imagen del QR)
│   ├── admin.ts              # TODAS las rutas /api/admin/* en una sola función (rewrite en vercel.json)
│   ├── yappy/config.ts       # GET   /api/yappy/config           (público, sin secretos)
│   ├── yappy/create-order.ts # POST  /api/yappy/create-order     (público, scoped a la orden)
│   └── yappy/ipn.ts          # GET   /api/yappy/ipn              (confirmación firmada de Yappy)
├── src/                      # frontend React
│   ├── shared/               # api.ts, config.ts, styles.css
│   ├── entradas/             # flujo de compra (+ YappyButton.tsx)
│   ├── admin/                # panel
│   └── validar/              # escáner de puerta
├── supabase/migrations/0001_init.sql   # schema + RPCs atómicas
├── supabase/migrations/0002_yappy_order_ref.sql  # order_ref corto p/ Yappy
├── supabase/migrations/0003_admin_panel.sql      # tier 'cortesia' + índice de uso
├── supabase/migrations/0004_courtesy_presale_quota.sql  # cortesías restan cupo de preventa
├── entradas.html · admin.html · validar.html · index.html
├── vite.config.ts · vercel.json · .env.example
```

## Puesta en marcha

### 1. Base de datos (Supabase)

Crea el proyecto en Supabase y corre la migración (SQL Editor o CLI):

```bash
# opción CLI
supabase db push   # o pega supabase/migrations/0001_init.sql en el SQL Editor
```

La migración crea `orders`, `event_config`, `tickets`, los índices, activa RLS
(sin policies → solo el service-role accede) y define las **RPCs atómicas**:
`create_order`, `mark_order_paid`, `validate_ticket`, `presale_status`,
`cleanup_expired_orders`, `mark_order_emailed`. La migración `0003` añade el
tier `cortesia` y el método de pago `courtesy` (entradas de regalo, $0) más un
índice parcial sobre `tickets.used_at` para el check-in en vivo. La migración
`0004` hace que las cortesías pagadas **resten cupo de preventa** (e.g. quedan
70 y se emiten 5 cortesías → quedan 65); emitirlas nunca se bloquea por cupo,
pero si lo exceden la preventa aparece agotada.

La migración `0010` añade el **aforo total del evento**
(`event_config.total_capacity`, default **230**): un tope duro de venta que
suma **todas** las tarifas (pagadas + pendientes con reserva vigente).
`create_order` lo valida de forma race-safe (mismo `for update` sobre
`event_config` que la preventa) y lanza `EVENT_SOLD_OUT` → el endpoint responde
409 `sold_out` y `/entradas` cierra el formulario con el aviso de "boletos
agotados". `presale_status` devuelve además `total_available` /
`event_sold_out`, que alimentan el contador público «quedan N boletos». Las
cortesías y regalos no pasan por `create_order` (el admin nunca se bloquea),
pero sí consumen aforo al contarse como pagadas. Para cambiar el tope:
`update event_config set total_capacity = <N> where id = 1;`.

## Panel de admin

Cuatro pestañas, todas contra rutas `/api/admin/*` (una sola función serverless,
ver nota abajo):

- **Resumen:** stats de preventa (+ toggle Etapa 2 y limpieza de vencidas),
  ventas (incl. ingresos por método de pago) y entradas emitidas/usadas/anuladas
  por tipo.
- **Órdenes:** búsqueda/filtros, marcar pagada (emite tickets + correo),
  **cancelar una pendiente puntual** (libera su cupo al instante), **reenviar el
  correo con los QR** de una pagada (excluye entradas anuladas), **reembolsar**
  una pagada (reversa Yappy + anula sus entradas, ver abajo), generar
  **cortesías** (orden $0 que pasa por el mismo `issueOrder()` idempotente, con
  o sin correo) y exportar CSV.
- **Entradas:** lista por comprador/tipo/estado con fecha y estación de uso;
  **anular** (`valid → void`, la puerta la rechaza) y **restaurar**
  (`void → valid`) con UPDATEs condicionales atómicos — una entrada usada no se
  puede anular ni restaurar. Export CSV.
- **Check-in:** asistencia en vivo (auto-refresh cada 10 s): adentro/por llegar
  por tipo, barra de progreso y últimas validaciones con estación.

> **Límite de funciones (Vercel Hobby):** el plan Hobby permite **máx. 12
> funciones serverless** por deploy y el proyecto está cerca del tope. Por eso
> TODAS las rutas `/api/admin/*` viven en **una sola función** (`api/admin.ts`)
> que enruta internamente (orders, cleanup, mark-paid, cancel, resend-email,
> stage2, tickets, revoke/unrevoke, courtesy). Un rewrite en `vercel.json` mapea
> `/api/admin/:path*` a `/api/admin?path=...` porque Vercel **no soporta
> archivos catch-all `[...path].ts`** fuera de Next.js (despliegan pero
> devuelven 404). Antes de añadir un archivo nuevo bajo `api/`, contar las
> funciones.

### 2. Variables de entorno

Copia `.env.example` y complétalo (en Vercel: Settings → Environment Variables).
Todas son **server-only**; ninguna se expone al navegador.

```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY, EMAIL_FROM="Still Louder <entradas@stilllouder.space>"
EMAIL_REPLY_TO                # opcional: buzón real (p. ej. Gmail) que recibe las respuestas
                              # del comprador; sin esto el correo no invita a responder
ORDER_NOTIFICATION_EMAIL      # opcional: aviso interno al registrarse una compra (lista separada por comas)
TICKET_HMAC_SECRET            # openssl rand -hex 32
ADMIN_PASSWORD, STAFF_PASSWORD
SUPPORT_PASSWORD              # opcional: rol de soporte (/support, solo lectura + reenviar correo).
                              # Vacío = solo el admin puede entrar a /support
CRON_SECRET                   # para el cron de limpieza (openssl rand -hex 16)
CUANTOAPP_PAYMENT_URL         # fallback genérico (link de pago con tarjeta)
CUANTOAPP_PAYMENT_URL_1..10   # un link por cantidad: producto oculto en el catálogo
                              # de CuantoApp con el precio ya recargado (la comisión
                              # 4.9%+$0.35 es por transacción, no por entrada). Ver .env.example
PUBLIC_BASE_URL=https://entradas.stilllouder.space
# Yappy Botón de Pago V2 (vacías = la opción Yappy se oculta sola)
YAPPY_BTN_MERCHANT_ID, YAPPY_BTN_SECRET_KEY (base64, se muestra UNA vez)
YAPPY_BTN_DOMAIN=https://entradas.stilllouder.space   # igual al portal
YAPPY_BTN_ENV=test|prod
YAPPY_BTN_CDN_URL             # opcional: override del CDN del web component
# Google Wallet (vacías = el botón "Agregar a Google Wallet" se oculta solo)
GOOGLE_WALLET_ISSUER_ID
GOOGLE_WALLET_SA_EMAIL        # client_email del JSON de la cuenta de servicio
GOOGLE_WALLET_SA_PRIVATE_KEY  # private_key del JSON (conservar los \n escapados)
GOOGLE_WALLET_CLASS_SUFFIX=wwwy3
```

### 3. Desarrollo local

```bash
cd ticket-system
npm install
npm run dev        # frontend en http://localhost:3100
```

Para correr las funciones `/api` localmente usa `vercel dev` (Vercel CLI), que
sirve frontend + funciones juntas y carga las variables del proyecto.

```bash
npm run typecheck  # tsc para src y api
npm run build      # build de producción a dist/
```

## Despliegue (Vercel)

Crea un **segundo proyecto Vercel** apuntando al mismo repo con:

- **Root Directory:** `ticket-system`
- **Framework Preset:** Vite (build `vite build`, output `dist`)
- Variables de entorno: las de arriba.
- Dominio: `entradas.stilllouder.space` (CNAME en el DNS del dominio).

El sitio estático actual (raíz del repo) sigue siendo su propio proyecto Vercel,
intacto. `vercel.json` aquí define headers de seguridad (CSP, HSTS,
`Permissions-Policy: camera=(self)` para el escáner) y el **cron diario** que
ejecuta `/api/admin/orders/cleanup`.

> **Frecuencia del cron de limpieza:** el plan **Hobby** (gratis) de Vercel solo
> permite crons **una vez al día**; una expresión horaria falla el deploy con
> _"Hobby accounts are limited to daily cron jobs"_. Por eso el `schedule` en
> `vercel.json` es `"0 6 * * *"` (diario; en Hobby, Vercel lo dispara en algún
> momento dentro de esa hora). Esto **no afecta la disponibilidad de cupos**: el
> conteo libera las reservas vencidas por timestamp (`reservation_expires_at >
> now()`), así que la limpieza es solo housekeeping (marcar como `cancelled`). Si
> suben a **Vercel Pro**, pueden volver a una frecuencia horaria (`"0 * * * *"`).
> El JSON no admite comentarios, por eso esta nota vive aquí y no en `vercel.json`.

> **Cloudflare:** la app también puede deployarse como Worker de Cloudflare sin
> reescribir la API (adaptador en `cloudflare/`, config en `wrangler.jsonc`).
> Guía completa: [`DEPLOY_CLOUDFLARE.md`](../DEPLOY_CLOUDFLARE.md) en la raíz.

> Alternativa: integrarlo en el proyecto existente bajo `/entradas` y `/validar`.
> Se eligió el proyecto aparte por la configuración inusual de `publicDir` del
> sitio actual; migrar es posible moviendo `api/` a la raíz y añadiendo las
> páginas al build multipágina.

## El QR firmado

Payload: `WWWY3.<ticket_id>.<sig>` con `sig = HMAC_SHA256(ticket_id, TICKET_HMAC_SECRET)`
truncado a 16 bytes (32 hex). En la puerta:

1. Se **recalcula el HMAC** y se compara (timing-safe). Firma inválida → rechazo
   inmediato **sin tocar la base** (`result: 'forged'`).
2. Solo si la firma es válida se ejecuta el `UPDATE` atómico que reclama el ticket.

El secreto vive solo en el servidor; es imposible fabricar entradas válidas sin él.

## Google Wallet (opcional — "Agregar a Google Wallet")

Mejora opcional (fase 3): cada entrada puede guardarse en Google Wallet. El
pase reutiliza **el mismo QR firmado HMAC** como código de barras
(`QR_CODE`), así que el validador de puerta lo escanea idéntico al del correo —
**no cambia la validación ni el cupo**. La legitimidad la respalda la firma
HMAC, no Google Wallet.

**Cómo está implementado:**

- `api/_lib/google-wallet.ts` — todo server-only. Firma un JWT **RS256** con la
  `private_key` de la cuenta de servicio usando `node:crypto` (sin dependencias
  nuevas; la llave nunca llega al cliente). Expone:
  - `buildWalletSaveUrl()` — cripto puro, sin red; arma el `eventTicketObject`
    inline y devuelve el `https://pay.google.com/gp/v/save/<jwt>`. Si Wallet no
    está configurado o algo falla, devuelve `null` y **nunca lanza** (el correo
    y la emisión nunca se rompen por esto).
  - `ensureEventTicketClass()` — crea la Passes Class del evento una sola vez
    (idempotente: hace GET por id y solo crea con POST si da 404).
- **Correo:** `api/_lib/email.ts` agrega un botón "Agregar a Google Wallet"
  bajo cada QR, solo cuando las credenciales están configuradas.
- **Endpoint on-demand:** `GET /api/wallet/google/:ticketId` redirige (302) al
  `saveUrl`, o con `?format=json` lo devuelve. Acotado al ticket (su UUID es la
  capacidad, igual que `/api/orders/:id/status`); no expone nada secreto.
- **Clase del evento:** botón **"Clase de Google Wallet"** en el panel admin
  (pestaña Resumen) → `POST /api/admin/wallet/google/ensure-class`. Córrelo una
  vez tras configurar las variables `GOOGLE_WALLET_*`. Re-ejecutarlo es no-op.

**Puesta en marcha:**

1. En Google Cloud: habilitar la **Google Wallet API**, crear una cuenta de
   servicio y descargar su llave **JSON**.
2. En la **Pay & Wallet Console**: crear el Issuer y agregar el `client_email`
   de la cuenta de servicio como usuario (Developer/Admin).
3. Configurar `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_EMAIL`,
   `GOOGLE_WALLET_SA_PRIVATE_KEY` y `GOOGLE_WALLET_CLASS_SUFFIX` (ver
   `.env.example`).
4. Pulsar **"Clase de Google Wallet"** en el panel admin (o `POST` al endpoint).

**Demo mode:** mientras el Issuer esté en demo, el pase solo se guarda con
cuentas de prueba (Admin/Developer o test accounts de la consola) y sale con
**"[TEST ONLY]"** en el título. Tras obtener acceso de publicación, cambiar
`reviewStatus` a `APPROVED` en `google-wallet.ts` y los pases salen a cualquier
usuario sin el rótulo. **Apple Wallet queda fuera de alcance** (requiere cuenta
Apple Developer de pago).

## Cómo se cumplen los criterios de aceptación

- **Emisión idempotente:** `mark_order_paid` transiciona `pending→paid` una sola
  vez y crea tickets solo si no existen; el correo se manda solo si `emailed_at`
  es null y luego se sella. Re-marcar no duplica nada.
- **Firma inválida → rechazo sin DB:** `verifyToken` corre antes de cualquier
  consulta (`api/tickets/validate.ts`).
- **Un QR válido se acepta una vez:** `validate_ticket` hace
  `update ... where id=$1 and status='valid'`; el segundo intento devuelve 0
  filas → "ya usada".
- **Dos escaneos simultáneos:** el `UPDATE` condicional es atómico; solo uno gana.
- **Admin/staff protegidos:** cada endpoint verifica el password (comparación
  constante) y devuelve 401 sin él.
- **Tope de preventa race-safe:** `create_order` toma `... for update` sobre la
  fila única de `event_config`, serializando los chequeos de cupo. No se vende de
  más con Etapa 2 inactiva (`presale_stage1_cap`) ni activa
  (`presale_stage1_cap + presale_stage2_cap`), contando pagadas + pendientes
  vigentes + cortesías pagadas.
- **Etapa 2 inmediata y configurable:** la capacidad se recalcula en vivo desde
  `event_config`; al activarla el admin elige cuántas entradas extra liberar
  (input en el panel → `presale_stage2_cap`, default 25) y el toggle las abre al
  instante.
- **Pending vencida libera cupo:** el conteo de cupo (`presale_status` y
  `create_order`) solo cuenta pendientes con `reservation_expires_at > now()`,
  así que una reserva vencida libera su cupo **al instante por timestamp**, sin
  esperar a la limpieza. `cleanup_expired_orders` (cron diario + botón admin) es
  solo housekeeping: marca esas pendientes como `cancelled`.
- **Correo desde `entradas@stilllouder.space`:** configurable vía `EMAIL_FROM`
  (requiere dominio verificado en Resend — DKIM/SPF/DMARC). El dominio solo
  **envía**: no hay recepción configurada, así que responder a `entradas@` no
  llega a nadie. `EMAIL_REPLY_TO` (opcional) pone un buzón real (p. ej. el
  Gmail de la banda) en el header Reply-To y habilita la frase "responde a
  este correo" en el footer; sin configurarla, el footer solo menciona los
  canales oficiales (@still_louder).

## Estado post-evento (archivado) y cómo reusarlo

El show del 1 de agosto **ya pasó**, así que el sistema está en modo *archivo*:
la venta y la puerta están cerradas por fecha, pero **nada se borró ni se
escondió** — `/admin`, `/support` y los datos siguen exactamente igual.

Las dos fechas que apagan el evento viven en **`api/_lib/event.ts`** (servidor,
autoridad) con espejo en `src/shared/config.ts` (`EVENT.salesEnd` /
`EVENT.eventEnd`), mismo patrón que los precios:

| Fecha       | Qué cierra                                                                              |
| ----------- | --------------------------------------------------------------------------------------- |
| `SALES_END` | `POST /api/orders` → `409 sales_closed`; `/api/gifts` (regalos) → cerrado. `/entradas` reemplaza el formulario y el countdown por el aviso "el show ya pasó". |
| `EVENT_END` | `POST /api/tickets/validate` → `200 { result: 'event_closed' }`, **antes de tocar la BD**. `/validar` muestra "PUERTA CERRADA". |

**Por qué la puerta se cierra y no solo la venta:** el payload del QR es
`WWWY3.<ticket_id>.<sig>`, firmado con un `TICKET_HMAC_SECRET` que **no está
scopeado por evento**. Quedan tickets `valid` sin usar de este show; con la
validación abierta, esos QR pasarían el gate del **próximo** evento. El cierre
por fecha corta esa vía hasta que los tickets tengan scope por evento.

### Teaser del próximo show (`/31-10`)

Ya hay fecha para el próximo show — **31 de octubre de 2026** — pero todavía no
hay diseño, paleta ni nada que vender. La dirección donde vivirá su formulario
existe desde ya, pero **solo con un teaser estático**:

- `31-10.html` + `src/teaser/` (App, `teaser.css`), entry `teaser` en
  `vite.config.ts`. **El nombre del archivo ES el path** (`cleanUrls`): se sirve
  en `/31-10` y en ningún otro lado, a propósito — mientras sea un teaser, el
  show nuevo tiene **un solo enlace público**. Su slug definitivo se agrega como
  rewrite en `vercel.json` cuando el evento tenga nombre, igual que
  `/when-we-were-young-3` → `/entradas`.
- **No toca el backend**: no llama a ningún endpoint, no hay evento en la BD, no
  hay tarifas ni cupo. No consume ninguna de las 12 funciones del plan Hobby.
- **No reusa el tema de `/entradas`**: esa es la identidad morada/rosa de WWWY3.
  El teaser es monocromo a propósito (negro + hueso, fuentes `Anton`/`Archivo`
  ya auto-hospedadas) para no adelantar decisiones visuales del evento nuevo.
- La fecha vive en `NEXT_EVENT` (`src/shared/config.ts`), **aparte de `EVENT`**,
  que sigue describiendo WWWY3 con su venta cerrada y su puerta congelada.
- Sin `og:image`: el único arte que existe es el flyer de WWWY3 y usarlo ahí
  anunciaría el evento equivocado.

`/entradas` y `/when-we-were-young-3` **no cambian**: siguen sirviendo el
archivo de WWWY3 para quien llegue buscando su compra.

### Para el próximo evento

Mientras el sistema siga siendo de **un solo evento** (una fila en
`event_config`, tarifas y fechas en código), reusarlo es una edición manual:

1. Fechas: `api/_lib/pricing.ts` (`PRESALE_START_ISO`, `PRESALE_END_ISO`),
   `api/_lib/event.ts` (`SALES_END_ISO`, `EVENT_END_ISO`) y su espejo en
   `src/shared/config.ts` (`EVENT`).
2. Precios/tarifas: `TIER_PRICE_CENTS` (`pricing.ts`) + `TIERS` (`config.ts`).
3. Aforo: `event_config.total_capacity` y los caps de preventa (admin / SQL).
4. Copia y arte: `entradas.html` / `ayuda.html` (título, descripción, OG),
   `src/entradas/App.tsx`, `src/ayuda/App.tsx` (hoy en pasado), `wwwy3-title.webp`.
   El teaser de `/31-10` (`src/teaser/`) se reemplaza entero por el flujo de
   compra real — nada de él está pensado para sobrevivir al anuncio.
5. **Rotar `TICKET_HMAC_SECRET`** para que ningún QR viejo pueda validarse, y
   cambiar el prefijo del token en `api/_lib/hmac.ts`.
6. Datos del evento anterior: los `orders`/`tickets` viejos quedan mezclados con
   los nuevos en los reportes de `/admin` — hoy no hay columna de evento.

Los puntos 5 y 6 son exactamente los que **una tabla `events` resolvería de
raíz** (FK en `orders`/`tickets`, config servida desde la BD, prefijo de QR y
reportes con scope por evento). Es el siguiente trabajo pendiente si el
ticketing se va a usar de forma recurrente; hasta entonces, seguir la lista.

## Notas operativas

- **Resend plan gratis:** 3,000/mes y **100/día**. En días pico, un correo por
  orden (no por entrada) ayuda; vigilar el límite diario.
- **Ventana de reserva:** efectivo/CuantoApp = 48 h; Yappy = 15 min
  (`api/_lib/pricing.ts`).
- **Precios:** se calculan en el servidor a partir de (tier, cantidad); el cliente
  nunca envía montos.
- **Recargo por método de pago ("Cargo por servicio"):** el comprador paga un
  precio _grossed-up_ que absorbe la comisión, de modo que el **neto** que recibe
  la banda = precio base. Fórmula (por transacción, el fijo se aplica una sola
  vez): `precioFinal = (neto + feeFijo) / (1 − feePorcentual)`, redondeado hacia
  arriba al centavo. CuantoApp 4.9% + $0.35 · Yappy 1.07% (mín. $0.02) · efectivo
  sin recargo. Cada orden guarda el desglose `net_cents` / `fee_cents` /
  `total_cents` (`api/_lib/pricing.ts`, migración `0005`).

## Yappy — Botón de Pago V2

Checkout embebido con el web component `<btn-yappy>`. La emisión NO cambió: la
IPN autenticada llama `issueOrder()` — la misma rutina idempotente que todo lo
demás. Soporte/doc: botondepagoyappy@bgeneral.com.

**Flujo:**

1. El comprador elige Yappy (la opción solo aparece si `GET /api/yappy/config`
   dice `enabled`, es decir, si las credenciales están configuradas) y crea su
   orden normal (`POST /api/orders`, reserva de 15 min).
2. La página de confirmación carga el web component desde el CDN (test o prod,
   decidido por el servidor) y, al hacer clic, llama
   `POST /api/yappy/create-order { orderId }`. **En el backend** se ejecutan los
   dos llamados de Yappy (validar comercio → `payment-wc`) y se devuelven
   `{transactionId, token, documentName}` para `eventPayment()`. Ningún secreto
   toca el navegador.
3. La confirmación real llega por **`GET /api/yappy/ipn`**: se valida el hash
   HMAC (clave = primer segmento del secreto base64-decodificado; mensaje =
   `orderId + status + domain`) y solo `status='E'` con hash válido transiciona
   `pending → paid` vía `issueOrder()` (idempotente: IPNs repetidas no duplican
   tickets ni correos). `R`/`C`/`X` no tocan la orden; el cupo se libera al
   vencer la reserva.
4. `eventSuccess` del botón es solo UX: la página hace **polling** a
   `GET /api/orders/:id/status` hasta ver `paid` (sobrevive a un refresh — la
   orden pendiente se guarda en `sessionStorage`). Si la reserva vence, la UI
   ofrece crear una nueva orden.

**`order_ref` (migración `0002`):** el `orderId` de Yappy admite máx. 15
caracteres, así que cada orden recibe un ref corto único (`WW` + 10 chars
A-Z/2-9) que es lo que Yappy ve; la IPN lo resuelve de vuelta a la orden. El
`transactionId` de Yappy queda en `orders.yappy_transaction_id` y el
`confirmationNumber` de la IPN en `orders.payment_ref`. Si Yappy responde
`E007` (pedido ya registrado), `create-order` genera un ref nuevo y reintenta —
nunca se reusa un ref quemado.

**Pruebas (UAT):** `YAPPY_BTN_ENV=test` usa `api-comecom-uat.yappycloud.com` y
el CDN UAT. Hay que inscribir usuarios de prueba (cuenta Gmail + celular
panameño) escribiendo a botondepagoyappy@bgeneral.com; en UAT el `aliasYappy`
es el teléfono del usuario de prueba (el comprador lo pone en el campo
teléfono, requerido para Yappy).

**Pendientes a confirmar en UAT** (ver comentarios en `api/_lib/yappy.ts`):
si `paymentDate` va en segundos o milisegundos; cuál variante del CDN de prod
resuelve (`bt-cdn.yappy.cloud` vs `bt-cdn.yappycloud.com` — override con
`YAPPY_BTN_CDN_URL`); y si en prod `aliasYappy` es requerido o lo ingresa el
cliente en el modal.

## Reembolsos

El botón **"Reembolsar"** (pestaña Órdenes, solo en órdenes `paid`) deshace el
lado del dinero de una compra y anula sus entradas, en espejo de cómo "Anular"
deshace una entrada individual. Una orden pagada **nunca** se "cancela" (eso es
solo para pendientes): pasa a un estado nuevo `refunded`.

**Flujo (`api/_lib/refund.ts` → `refundOrder()`):**

1. **Reversa del dinero (solo Yappy, automática):** llama
   `reverseYappyPayment()` contra la **API de Yappy Comercial** (distinta del
   Botón de Pago V2; host `YAPPY_API_BASE`, que **ya incluye `/v1`**). Son **dos
   pasos**: (a) `POST {base}/session/login` con un `code` derivado server-side
   — `HMAC-SHA256(apiKey + fecha YYYY-MM-DD)` firmado con el **Seed Code** (no el
   secret key), en hora de Panamá — y headers `api-key` + `secret-key`, para
   obtener un **token de sesión**; (b) `PUT {base}/transaction/{transactionId}`
   con `Authorization: Bearer <token>` + `api-key` + `secret-key` + `client-ip` +
   `channel`. `transactionId` es el `orders.yappy_transaction_id` guardado al
   crear el pago. `YP-0000` (reversada) y `YP-0016` (ya reversada) se tratan como
   éxito; cualquier otro código (`YP-0014` ya liquidada/fuera de ventana,
   `YP-0013`, `YP-0008` cabeceras faltantes, `YP-0002`, `YP-9999`) se trata como
   fallo y **no se toca la base de datos**.
2. **Registro atómico:** al confirmar la reversa (o de una vez para
   efectivo/CuantoApp/manual), la RPC `refund_order` marca la orden `refunded`,
   sella `refunded_at`/`refund_ref` y **anula (`void`) todas las entradas
   `valid`** en una sola transacción (las `used` se respetan: ya entraron).
   Idempotente.
3. **Reportes:** como las stats de ingresos solo cuentan `status='paid'`, una
   orden `refunded` sale automáticamente de los ingresos; el Resumen muestra un
   total reembolsado aparte.

**Ventana "en tránsito":** la reversa por API de Yappy solo funciona el mismo
día, mientras la transacción no se haya acreditado. Si Yappy la rechaza (o la
API no está configurada), la UI ofrece **marcar la orden como reembolsada
manualmente** (`{ manual: true }`): se anulan las entradas igual y el dinero se
devuelve por fuera (portal de Yappy). Para efectivo/CuantoApp el reembolso es
siempre manual (no hay API).

**Configuración** (`api/_lib/env.ts`; sin las credenciales solo queda el modo
manual): las **tres** credenciales del portal Yappy Comercial → Integraciones →
Generar Credenciales — `YAPPY_API_KEY` (header `api-key` **y** sujeto del hash),
`YAPPY_API_SECRET_KEY` (solo header `secret-key`) y `YAPPY_API_SEED` (el "código
semilla", que es la **clave del HMAC** del `code` de login — ni header ni body) —
más `YAPPY_API_CHANNEL` (confirmar valor con Yappy) y, **crítico**,
`YAPPY_API_BASE` (el host, que **ya incluye `/v1`**; probar primero la URL **UAT**
y luego prod). `isYappyRefundConfigured()` exige las tres credenciales.
Migración: `supabase/migrations/0006_refunds.sql` (estado `refunded` + columnas
+ RPC).

El algoritmo del `code` está verificado contra el ejemplo del manual mediante un
*self-test* en `yappy.ts` (HMAC con Seed Code sobre `apiKey+fecha`); si se rompe,
el módulo loguea `login-code HMAC self-test FAILED`. Hay además logging temporal
(`console.error [yappy] ...`) en ambos pasos para ver en los Logs de Vercel
(proyecto ticket-system → Logs, filtrar `/api/admin`) en qué paso y con qué
código rebota.

> **A confirmar con soporte de Yappy / en UAT:** (1) si exigen **allowlist de la
> IP de origen** — las funciones de Vercel salen con IPs dinámicas, lo que sería
> el principal riesgo arquitectónico; (2) el **nombre exacto y el valor** del
> header de IP (hoy `client-ip` con la IP del navegador del admin) y de `channel`
> (`YP-0008` = cabeceras obligatorias faltantes); (3) la TZ esperada de la fecha
> del `code` (hoy Panamá) cerca de medianoche.
