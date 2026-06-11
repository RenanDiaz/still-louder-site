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
tier `cortesia` y el método de pago `courtesy` (entradas de regalo, $0, fuera
del cupo de preventa) más un índice parcial sobre `tickets.used_at` para el
check-in en vivo.

## Panel de admin

Cuatro pestañas, todas contra rutas `/api/admin/*` (una sola función serverless,
ver nota abajo):

- **Resumen:** stats de preventa (+ toggle Etapa 2 y limpieza de vencidas),
  ventas (incl. ingresos por método de pago) y entradas emitidas/usadas/anuladas
  por tipo.
- **Órdenes:** búsqueda/filtros, marcar pagada (emite tickets + correo),
  **cancelar una pendiente puntual** (libera su cupo al instante), **reenviar el
  correo con los QR** de una pagada (excluye entradas anuladas), generar
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
ORDER_NOTIFICATION_EMAIL      # opcional: aviso interno al registrarse una compra (lista separada por comas)
TICKET_HMAC_SECRET            # openssl rand -hex 32
ADMIN_PASSWORD, STAFF_PASSWORD
CRON_SECRET                   # para el cron de limpieza (openssl rand -hex 16)
CUANTOAPP_PAYMENT_URL         # opcional (link de pago con tarjeta)
PUBLIC_BASE_URL=https://entradas.stilllouder.space
# Yappy Botón de Pago V2 (vacías = la opción Yappy se oculta sola)
YAPPY_BTN_MERCHANT_ID, YAPPY_BTN_SECRET_KEY (base64, se muestra UNA vez)
YAPPY_BTN_DOMAIN=https://entradas.stilllouder.space   # igual al portal
YAPPY_BTN_ENV=test|prod
YAPPY_BTN_CDN_URL             # opcional: override del CDN del web component
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
  más con Etapa 2 inactiva (75) ni activa (150), contando pagadas + pendientes
  vigentes.
- **Etapa 2 inmediata:** la capacidad se recalcula en vivo desde `event_config`;
  el toggle abre 75 cupos al instante.
- **Pending vencida libera cupo:** el conteo de cupo (`presale_status` y
  `create_order`) solo cuenta pendientes con `reservation_expires_at > now()`,
  así que una reserva vencida libera su cupo **al instante por timestamp**, sin
  esperar a la limpieza. `cleanup_expired_orders` (cron diario + botón admin) es
  solo housekeeping: marca esas pendientes como `cancelled`.
- **Correo desde `entradas@stilllouder.space`:** configurable vía `EMAIL_FROM`
  (requiere dominio verificado en Resend — DKIM/SPF/DMARC).

## Notas operativas

- **Resend plan gratis:** 3,000/mes y **100/día**. En días pico, un correo por
  orden (no por entrada) ayuda; vigilar el límite diario.
- **Ventana de reserva:** efectivo/CuantoApp = 48 h; Yappy = 15 min
  (`api/_lib/pricing.ts`).
- **Precios:** se calculan en el servidor a partir de (tier, cantidad); el cliente
  nunca envía montos.

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
