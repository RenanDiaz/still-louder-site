# Pago con tarjeta vía Tilopay (reemplaza los links de CuantoApp)

> Subsistema: `ticket-system/`. Agrega un método de pago con tarjeta
> **automático** (Tilopay) que reemplaza el flujo manual de CuantoApp. Yappy no
> se toca.

## Estado: borrador (15 nov 2026)

No implementado. La OpenAPI pública de Tilopay (`tilopay.com/developers/openapi.json`,
revisada el 15 nov 2026) resolvió lo que bloqueaba el diseño: existe consulta de
transacción por número de orden (`consult`) y reembolso por API
(`processModification`). Quedan abiertas P3 (Apple/Google Pay en la página
alojada), P5 (retenciones en Panamá), P6 (afiliación) y P7 (dirección de
facturación). Lo que dependa de ellas está marcado con **(P#)**.

## Contexto y problema

Hoy la tarjeta se cobra con CuantoApp y **todo es manual**
(`api/_lib/cuantoapp.ts`, pestaña CuantoApp del admin):

| Dolor | Detalle |
|---|---|
| 10 productos por precio | Un producto oculto en CuantoApp por cantidad (1–10) con el precio ya recargado, links en `CUANTOAPP_PAYMENT_URL_1..10`. Cambiar un precio = editar productos en CuantoApp + revisar 10 links en el admin. Los links son globales, no por evento. |
| Confirmación humana | El admin concilia el pago contra la orden y pulsa "marcar pagada". El comprador espera su QR hasta que alguien revisa. |
| Reserva de 48 h | El cupo de una orden con tarjeta queda retenido hasta 48 h (`RESERVATION_MINUTES.cuantoapp`), porque la conciliación es humana. |
| Monto no verificado | Nada impide abrir el link de otra cantidad o pagar otro monto; se descubre (si se descubre) al conciliar. |
| Comisión | 4.9% + $0.35 por transacción. |

Tilopay (pasarela de Costa Rica con operación en Panamá) cobra **3.75% + $0.50**
con Visa/Mastercard/Amex en Panamá, **sin afiliación ni mensualidad**, e incluye
Apple Pay y Google Pay a la misma tarifa (tabla de tarifas de Panamá en
tilopay.com, revisada el 15 nov 2026).

En comisión es casi lo mismo (por orden: 1×$12 → $0.99 en ambos; 2×$12 → $1.61
vs. $1.46; 4×$12 → $2.85 vs. $2.39; Tilopay sale más barato por encima de ~$13
de neto), **antes de impuestos/retenciones (P5)**. **El motivo del cambio es la
automatización**: la tarjeta pasa a funcionar como Yappy (el servidor crea el
cobro, el proveedor confirma, se emite solo).

### API de Tilopay que usamos

Un solo host para producción y modo de prueba: `https://app.tilopay.com`. El
modo (producción/prueba) **se cambia en la cuenta del comercio**, no por host.
Los errores vienen en el cuerpo (`type` ≠ `"100"`/`"200"`), no en el status HTTP.

| Endpoint | Para qué | Notas |
|---|---|---|
| `POST /api/v1/login` `{ apiuser, password }` | Token bearer | `expires_in: 86400` (24 h). |
| `POST /api/v1/processPayment` | Crea la transacción de la página alojada | Body: `key`, `amount` (string `"12.99"`), `currency: "USD"`, `orderNumber`, `capture: "1"`, `redirect` (URL GET de retorno), `billTo*` (todos requeridos, P7), `subscription: "0"`, `platform`, `returnData` (base64), `token_version: "v2"`. Respuesta `{ type: "100", url }` → redirigir al comprador a `url`. **No acepta `webhook_url`.** |
| Redirect de retorno (GET) | Vuelve el comprador | Query: `code` (`1` = aprobada), `description`, `auth`, `order`, `tilopay-transaction`, `OrderHash`, `returnData`. El algoritmo de `OrderHash` no es público (se pide a soporte) → **no lo usamos**: verificamos con `consult`. |
| `POST /api/v1/consult` `{ key, orderNumber }` | **Fuente de verdad** del pago | Devuelve un **arreglo** de transacciones de esa orden: `id_tilopay`, `amount`, `currency`, `code` (`"1"` = aprobada), `auth`, `type` (`"Payment"`…), `environment` (`"Test"`/`"Production"`), y el desglose `commission`, `iva_commission`, `retention_iva`, `retention_rent`, `cost`, `cost_iva`, `net_to_liquidate`. |
| `POST /api/v1/processModification` `{ key, orderNumber, type, amount }` | Reembolso (`type: "2"`) o reverso (`"3"`) | Aprobado = `ReasonCode: "1101"`. |
| `POST /api/v1/consultTransactions` | Listado por rango de fechas (filtros `orderNumber`, `onlyAproved`, `environment`) | Para conciliación/cierre, no para emitir. |

## Objetivos

1. Pagar con tarjeta (y Apple Pay / Google Pay **(P3)**) desde `/entradas` y
   recibir el QR **sin intervención del admin**.
2. El monto del cobro sale de la orden (`orders.total_cents`, calculado por
   `pricing.ts`); desaparecen los productos por cantidad.
3. Reserva corta (minutos, no 48 h).
4. Conservar las invariantes: emisión independiente del proveedor
   (`issue.ts`), precio autoritativo del servidor, secretos solo en el Worker.

## Fuera de alcance

- **Yappy vía Tilopay.** Tilopay lo cobra a 1%; nuestro Yappy directo cuesta
  1.07% (1% + ITBMS) y ya funciona con IPN firmado y reversas por API. Ahorro
  de < $0.01 por entrada no justifica tocar la integración que mejor anda.
- Cuotas (Tasa Cero BAC, Tafi, Crediviva): irrelevantes con entradas de $10–12.
- Suscripciones, tokenización, links de pago, split de liquidación.

## Decisiones

| # | Decisión | Resolución | Por qué |
|---|---|---|---|
| D1 | Valor de `payment_method` | Nuevo valor **`tilopay`** (no reusar `cuantoapp`). Etiqueta al comprador: "Tarjeta". | Durante la convivencia los reportes y el cierre tienen que separar qué depositó cada procesador (comisiones distintas). |
| D2 | Modo de integración | **Página de pago alojada** (`processPayment` → redirect), no el SDK embebido. Si la página alojada no ofrece Apple/Google Pay **(P3)**, se reevalúa el SDK como Fase 1b. | Los datos de tarjeta nunca tocan nuestro dominio (alcance PCI mínimo, SAQ A), CSP sin cambios, sin archivo de verificación de dominio de Apple Pay. |
| D3 | Fuente de verdad del pago | **`consult` por `orderNumber`**, nunca los parámetros del redirect (`code`, `OrderHash`) ni ningún aviso entrante. El retorno del comprador y la conciliación periódica (D13) solo disparan una verificación server-side. | Mismo principio del IPN de Yappy (nada se emite sin verificar). Evita depender del algoritmo privado de `OrderHash`. |
| D4 | Condición para emitir | En la respuesta de `consult`, **alguna** transacción con `code === "1"`, `type === "Payment"`, `amount` == `orders.total_cents`, `currency === "USD"` y **`environment` == el esperado** (`TILOPAY_ENV`: `Production` en prod). Si hay una aprobada pero algo no cuadra: no emitir, `console.error` y dejar la orden para revisión humana. | `consult` devuelve un arreglo (intentos rechazados + el aprobado). El chequeo de `environment` es **crítico**: el modo de prueba se cambia en la cuenta, así que si alguien la deja en prueba, una tarjeta de prueba no puede emitir entradas reales. |
| D5 | Emisión | `issueOrder(order.id, <auth>)` — la misma rutina idempotente que usan el admin y el IPN de Yappy. | Invariante de emisión independiente del proveedor. Retorno + conciliación pueden verificar la misma orden varias veces sin duplicar nada. |
| D6 | `orderNumber` | Nuestro `orders.order_ref` (mismo generador que Yappy, `assignNewOrderRef`). Al emitir se guardan `id_tilopay` en la columna nueva `tilopay_transaction_id`, `auth` en `payment_ref` y `net_to_liquidate` en `processor_net_cents` (D14). Si Tilopay rechaza reusar un `orderNumber` tras un intento rechazado **(P8)**, se asigna un `order_ref` nuevo por intento (como E007 en Yappy) y `consult` se hace con el vigente. | Mismo patrón que `yappy_transaction_id` (0002). El ID y el `orderNumber` hacen falta para reembolsar. |
| D7 | Reserva | `RESERVATION_MINUTES.tilopay = 20`. | Pago síncrono como Yappy (15 min) + margen por 3-D Secure y redirect. |
| D8 | Comisión | `PAYMENT_FEES.tilopay = { pct: 0.0375, fixedCents: 50, minFeeCents: 0 }` en `pricing.ts` **y** su espejo en `src/shared/config.ts`. Si en Panamá se descuenta ITBMS sobre la comisión o hay retenciones **(P5)**, se ajusta `pct`/`fixedCents` antes de abrir venta para que el neto liquidado siga ≥ precio base. | Gross-up por transacción igual que hoy: la banda recibe el precio base. `consult` confirma que el desglose existe (`iva_commission`, `retention_*`, `cost_iva`). |
| D9 | Habilitación | Igual que Yappy: si faltan las variables `TILOPAY_*`, la opción se oculta sola (`GET /api/tilopay/config` → `{ enabled }`). **No** van a `REQUIRED_SECRETS` de `release-cloudflare.mjs`: la API funciona sin ellas. | Despliegue gradual sin romper nada. |
| D10 | Convivencia con CuantoApp | La opción "Tarjeta" del comprador usa **Tilopay si está habilitado; si no, CuantoApp** (nunca las dos a la vez). El admin conserva "marcar pagada" para órdenes `cuantoapp` pendientes. CuantoApp se retira en la Fase 3. | Respaldo inmediato si Tilopay falla en producción: vaciar una variable y redeployar. |
| D11 | Retorno del comprador | `redirect` = `/entradas` de su evento con `?orden=<uuid>&tilopay=retorno`; `returnData` = base64 del UUID (respaldo si se pierde el query). La app reabre la confirmación, llama a `POST /api/tilopay/confirm` y sondea `/api/orders/<id>/status` (mismo patrón que `YappyCheckout`). | El retorno verifica de inmediato en el caso normal. La orden pendiente sobrevive a un refresh (como `sl.pendingYappyOrder.<slug>`). |
| D12 | Pago sobre orden cancelada | Si `consult` muestra un pago aprobado de una orden ya `cancelled`, **no se emite**: `console.error` + la orden aparece en el admin para reembolso (D15) o emisión manual. | Mismo criterio que `api/yappy/ipn.ts`. Con D13 debería ser rarísimo. |
| D13 | Conciliación (reemplaza al webhook) | `processPayment` **no ofrece webhook**. Nuevo cron **cada 5 min** en `wrangler.jsonc`: toma órdenes `tilopay` `pending` creadas en las últimas 24 h y llama `verify` a cada una. Además, la limpieza diaria verifica con `consult` antes de cancelar una orden `tilopay` vencida. | Cubre al comprador que paga y cierra la pestaña antes del redirect: recibe su QR en ≤ 5 min. Con 20 min de reserva son ~4 consultas por orden abandonada; volumen trivial. |
| D14 | Neto real | Columna `orders.processor_net_cents` con `net_to_liquidate` de `consult` (solo `tilopay` por ahora). El cierre de Reportes usa el neto real cuando existe y la estimación de `estimateProcessorFeeCents` cuando no. | Hoy la comisión del cierre es una estimación (`reportes-admin.md`, D5); Tilopay da el dato exacto, incluidas retenciones. |
| D15 | Reembolsos | `refund.ts` llama a `processModification` (`type: "2"`, monto completo) para órdenes `tilopay`, con el mismo contrato que Yappy: si falla, no toca la BD y el admin puede caer al reembolso manual. | Elimina el paso manual también al reembolsar. Reverso (`"3"`) solo si Tilopay indica que aplica antes de liquidar **(P4)**. |

## Flujo

```
Comprador            /entradas            Worker (api/)                    Tilopay
   │ elige "Tarjeta"     │                     │                              │
   │────────────────────▶│ POST /api/orders    │ create_order (method=tilopay,│
   │                     │────────────────────▶│ total por pricing.ts, 20 min)│
   │                     │ POST /api/tilopay/  │                              │
   │                     │   create-payment    │ login → processPayment       │
   │                     │────────────────────▶│ (amount, USD, orderNumber=   │
   │                     │                     │  order_ref, redirect=…)      │
   │                     │◀──────── { url }────│◀──────── { type:100, url } ──│
   │◀── location.assign ─│                     │                              │
   │──────────────── paga en la página de Tilopay (3DS / Apple Pay) ─────────▶│
   │◀──────────── redirect GET /entradas?orden=…&tilopay=retorno&code=… ──────│
   │                     │ POST /api/tilopay/  │                              │
   │                     │   confirm           │ verify(order): consult ─────▶│
   │                     │────────────────────▶│ D4 OK → issueOrder           │
   │                     │ sondea /api/orders/<id>/status hasta `paid` → "Revisa tu correo"
   │                     │                     │                              │
   │   (si cerró la pestaña)   cron */5 min ──▶│ verify(order) para pending ─▶│
```

`verify(order)` vive en `api/_lib/tilopay.ts` y es la **única** función que
decide emitir: `consult` por `order_ref`, aplica D4 y llama `issueOrder`. La
usan `confirm`, el cron de conciliación y la limpieza.

## Cambios

### Base de datos — `supabase/migrations/0019_tilopay.sql`

- `orders.payment_method` check: agregar `'tilopay'` (mismo patrón que 0003/0008).
- `alter table orders add column tilopay_transaction_id text, add column processor_net_cents integer;`
- Índice parcial para el cron: `on orders (created_at) where payment_method = 'tilopay' and status = 'pending'`.
- `report_settlement` (0018) tiene columnas fijas por método (`net_yappy`,
  `net_cuantoapp`, `net_cash`): agregar `net_tilopay` y el neto real (D14), y
  revisar las demás `report_*` que filtren por método. Ajustar
  `api/_lib/reports.ts` (`netByMethod`, CSV, HTML imprimible) y
  `src/admin/ReportesTab.tsx`.

### Backend

| Archivo | Qué |
|---|---|
| `api/_lib/tilopay.ts` (nuevo) | Cliente: `isTilopayConfigured()`, `login()` con caché del token (24 h) por isolate y reintento ante 401, `createPayment(order)`, `consult(orderRef)`, `refund(order)`, `verify(order)` (D3–D6, D12). Interpreta errores por `type` del cuerpo, no por status HTTP. Formatea `amount` desde centavos (`(cents / 100).toFixed(2)`). Solo server. |
| `api/tilopay/config.ts` (nuevo) | `GET` → `{ enabled }`. |
| `api/tilopay/create-payment.ts` (nuevo) | `POST { orderId }`. El UUID es la capacidad (como `yappy/create-order`). Solo órdenes `pending` y `tilopay`. Asigna `order_ref` si falta. Devuelve `{ url }`. |
| `api/tilopay/confirm.ts` (nuevo) | `POST { orderId }` desde la página de retorno → `verify`. No-op si la orden ya no está `pending`. Ignora los parámetros del redirect. |
| `cloudflare/worker.ts` | Registrar las 3 rutas. `scheduled()` distingue el cron diario (limpieza) del de 5 min (conciliación: `/api/admin?path=orders/reconcile-tilopay`, autenticado con `CRON_SECRET` como la limpieza). |
| `wrangler.jsonc` | `triggers.crons`: agregar `"*/5 * * * *"`. |
| `api/admin.ts` | Ruta `orders/reconcile-tilopay` (cron) y, en la limpieza, `verify` antes de cancelar órdenes `tilopay`. |
| `api/_lib/pricing.ts` + `src/shared/config.ts` | D7, D8. |
| `api/_lib/types.ts` | `PaymentMethod` += `'tilopay'`. |
| `api/_lib/refund.ts` | D15. |

Variables del Worker (`wrangler secret`, documentar en `ticket-system/README.md`
y `.env.example`): `TILOPAY_API_USER`, `TILOPAY_API_PASSWORD`,
`TILOPAY_API_KEY` (clave de integración, "Admin panel → Platform
integrations"), y la var `TILOPAY_ENV` = `Production` | `Test` (D4).

### Frontend

- `src/shared/config.ts` — `PAYMENT_METHODS`: la entrada de tarjeta resuelve a
  `tilopay` o `cuantoapp` según `GET /api/tilopay/config` (D10). Etiqueta
  "Tarjeta (Visa, Mastercard, Amex, Apple Pay, Google Pay)" — Apple/Google
  solo si **(P3)** se confirma.
- `src/entradas/App.tsx` — nuevo `TilopayCheckout`: botón "Pagar con tarjeta"
  → `create-payment` → `location.assign(url)`. Al volver
  (`?tilopay=retorno`): `confirm` + sondeo, con estados "Confirmando tu pago…",
  "Pago confirmado — revisa tu correo", "No se completó el pago — puedes
  intentar de nuevo" (mientras la reserva siga viva) y "Tu reserva venció".
  El `code` del redirect solo se usa para elegir el mensaje inicial, nunca para
  dar la compra por hecha. Persistir la orden pendiente en `localStorage` como
  Yappy.
- `src/shared/api.ts` — tipos y llamadas nuevas; `payment_method` += `'tilopay'`.
- Admin / soporte (`src/admin/App.tsx`, `src/support/App.tsx`,
  `ReportesTab.tsx`): etiqueta "Tarjeta (Tilopay)" para distinguirla de
  CuantoApp mientras convivan.
- Textos al comprador: `src/ayuda/App.tsx` y `src/como-comprar/App.tsx`
  mencionan CuantoApp; actualizar cuando Tilopay esté activo (`/como-comprar`
  cita las etiquetas del formulario — mantenerlas en sync).
- Analytics: eventos de cliente `tilopay_redirect` y `tilopay_return`
  (`{ result }`), sin PII. `purchase` sigue saliendo del servidor desde
  `issue.ts`.

### CSP (`ticket-system/public/_headers`)

Sin cambios: el redirect es una navegación (`location.assign`) y todas las
llamadas a `app.tilopay.com` son server-side. Si se pasa al SDK embebido (Fase
1b) habría que agregar sus dominios en `script-src`/`connect-src`/`frame-src`.

## Criterios de aceptación

1. Con las variables `TILOPAY_*` vacías, `/entradas` se ve y funciona como hoy
   (tarjeta = CuantoApp).
2. Con Tilopay habilitado y la cuenta en modo prueba (`TILOPAY_ENV=Test`), una
   compra aprobada termina en `paid`, con entradas emitidas y correo enviado,
   sin tocar el admin.
3. Con `TILOPAY_ENV=Production`, una transacción aprobada en modo prueba
   (`environment: "Test"`) **no** emite y deja un `console.error`.
4. El monto cobrado por Tilopay es exactamente `orders.total_cents`; el cliente
   no envía montos a ningún endpoint.
5. Un retorno con `code=1` falsificado (sin transacción aprobada en `consult`)
   no cambia ninguna orden.
6. Retorno + cron + limpieza procesando la misma orden emiten **una sola vez**
   (un correo, N entradas).
7. Una transacción aprobada por un monto distinto al de la orden **no** emite y
   deja un `console.error` con `order_id` y montos.
8. Si el comprador cierra la pestaña tras pagar, recibe el correo en ≤ 5 min
   por el cron de conciliación.
9. Un pago rechazado deja la orden `pending`; el comprador puede reintentar
   mientras la reserva siga viva, y el cupo se libera a los 20 min.
10. El reembolso desde el admin de una orden `tilopay` devuelve el dinero por
    API; si Tilopay falla, la orden no cambia y se ofrece el reembolso manual.
11. El cierre en Reportes muestra el neto de Tilopay separado de CuantoApp,
    usando `net_to_liquidate` real cuando existe.
12. Ningún secreto `TILOPAY_*` aparece en el bundle del cliente ni en
    respuestas de la API.
13. `npm run typecheck` pasa.

## Fases

| Fase | Alcance | Salida |
|---|---|---|
| 0 | Resolver P3, P5–P8 con Tilopay; abrir cuenta (P6). | Respuestas anotadas en este spec. |
| 1 | Todo lo de "Cambios". Probar con la cuenta en modo prueba → pasarla a producción → compra real de $1 en un evento de prueba temporal (`on_sale`, sin enlazar; se archiva después) → reembolsarla por API. | Tarjeta automática en el próximo evento, CuantoApp como respaldo (D10). |
| 1b | Solo si P3 = "la página alojada no trae Apple/Google Pay": evaluar el SDK embebido (`loginSdk`, CSP, verificación de dominio de Apple Pay). | Decisión documentada. |
| 2 | Tras un evento completo sin incidentes: retirar CuantoApp (`cuantoapp.ts`, `CuantoappTab`, `CUANTOAPP_PAYMENT_URL_*`, copy). El valor `cuantoapp` se queda en el check de la BD (órdenes históricas). | Un solo flujo de tarjeta. |

> El modo prueba/producción es de **toda la cuenta**: mientras se prueba, la
> cuenta no puede cobrar de verdad. Probar antes de abrir venta o pedir a
> Tilopay una cuenta de pruebas separada (P2).

## Preguntas abiertas

| # | Pregunta | Estado |
|---|---|---|
| P1 | Webhook y consulta de transacción. | **Resuelta (OpenAPI):** `processPayment` no tiene webhook; existe `consult` por `orderNumber` → D3, D13. |
| P2 | Sandbox. | **Parcial (OpenAPI):** sin host aparte; el modo se cambia en la cuenta y `consult` devuelve `environment`. Falta: tarjetas de prueba y si dan una cuenta de pruebas separada. |
| P3 | ¿La página alojada ofrece Apple Pay y Google Pay, o solo el SDK? ¿3-D Secure siempre? | Abierta — Tilopay. Bloquea el copy de la Fase 1 y decide la 1b. |
| P4 | Reembolsos por API. | **Resuelta (OpenAPI):** `processModification` (`2` reembolso, `3` reverso) → D15. Falta: costo del reembolso y cuándo aplica reverso vs. reembolso. |
| P5 | En Panamá, ¿qué se descuenta además del 3.75% + $0.50? El ejemplo de `consult` (probablemente Costa Rica) liquida **$4.04 de $5.00**: comisión + IVA, `retention_iva`, `retention_rent`, costo + IVA. Plazo y forma de depósito; costo de contracargos. | Abierta — asesor comercial. **Bloquea D8** antes de abrir venta: si hay retenciones, el gross-up tiene que cubrirlas o la banda recibe menos que el precio base. |
| P6 | Requisitos de afiliación para la banda (persona natural vs. jurídica, cuenta bancaria en Panamá). | Abierta — banda + Tilopay. |
| P7 | `processPayment` exige todos los `billTo*` (dirección, ciudad, estado, código postal, país, teléfono) y nosotros solo pedimos nombre, correo y teléfono opcional. ¿Se aceptan valores fijos (`PA`, `PA-8`, "Panamá"…) o afecta la aprobación/antifraude? ¿La página alojada los vuelve a pedir? | Abierta — Tilopay. Si exigen datos reales, el formulario de tarjeta pide país (y quizá dirección): cambio de UX a evaluar. |
| P8 | ¿Se puede reusar el mismo `orderNumber` tras un intento rechazado, o cada intento necesita uno nuevo? | Abierta — se resuelve probando en modo prueba (D6 cubre ambos casos). |

## Riesgos

- **Retenciones en Panamá (P5).** Si aplican como en el ejemplo de `consult`,
  el costo efectivo puede ser bastante mayor que 3.75% + $0.50 y Tilopay
  quedaría más caro que CuantoApp. Hay que tener el número antes de fijar
  `PAYMENT_FEES`; D14 permite verificarlo con datos reales después.
- **Cuenta dejada en modo prueba.** Mitigado por D4 (chequeo de
  `environment`) y el criterio 3.
- **Sin webhook.** Mitigado por D13 (cron de 5 min). Costo: hasta 5 min de
  espera para quien cierra la pestaña antes del redirect.
- **Proveedor nuevo en producción.** Mitigado por D9/D10 (respaldo a
  CuantoApp sin cambiar código) y la prueba de $1 con reembolso.
