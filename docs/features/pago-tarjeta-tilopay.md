# Pago con tarjeta vía Tilopay (reemplaza los links de CuantoApp)

> Subsistema: `ticket-system/`. Agrega un método de pago con tarjeta
> **automático** (Tilopay) que reemplaza el flujo manual de CuantoApp. Yappy no
> se toca.

## Estado: borrador (15 nov 2026)

No implementado. **Bloqueado por las preguntas abiertas P1–P3** (contrato del
webhook, sandbox, página alojada con Apple Pay/Google Pay). Lo que dependa de
sus respuestas está marcado con **(P#)**.

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
tilopay.com, revisada el 15 nov 2026). Tiene API (`POST /api/v1/login` →
token bearer; `processPayment`), webhooks y URL de retorno.

En comisión es casi lo mismo (por orden: 1×$12 → $0.99 en ambos; 2×$12 → $1.61
vs. $1.46; 4×$12 → $2.85 vs. $2.39; Tilopay sale más barato por encima de ~$13
de neto). **El motivo del cambio es la automatización**: la tarjeta pasa a
funcionar como Yappy (el servidor crea el cobro, el proveedor confirma, se emite
solo).

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
- Suscripciones, tokenización de tarjeta, guardar tarjetas.
- Reembolso automático por API en la Fase 1 (ver Fase 2, **(P4)**).

## Decisiones

| # | Decisión | Resolución | Por qué |
|---|---|---|---|
| D1 | Valor de `payment_method` | Nuevo valor **`tilopay`** (no reusar `cuantoapp`). Etiqueta al comprador: "Tarjeta". | Durante la convivencia los reportes y el cierre tienen que separar qué depositó cada procesador (comisiones distintas). |
| D2 | Modo de integración | **Página de pago alojada por Tilopay** (redirect), no el SDK embebido. Si la página alojada no ofrece Apple/Google Pay **(P3)**, se reevalúa el SDK como Fase 1b. | Los datos de tarjeta nunca tocan nuestro dominio (alcance PCI mínimo, SAQ A), CSP sin cambios de `script-src`/`frame-src`, sin archivo de verificación de dominio de Apple Pay. |
| D3 | Fuente de verdad del pago | **La consulta a la API de Tilopay**, nunca el contenido del webhook ni la URL de retorno. Ambos solo disparan una verificación server-side. | Lo recomienda la propia documentación de Tilopay, y es el mismo principio del IPN de Yappy (nada se emite sin verificar). |
| D4 | Condición para emitir | Transacción **aprobada** + **monto == `orders.total_cents`** + moneda **USD** + referencia == nuestro `order_ref`. Si algo no cuadra: no emitir, loguear `console.error` y dejar la orden para revisión humana. | Cierra el hueco de "pagó otro monto" que hoy tiene CuantoApp. |
| D5 | Emisión | `issueOrder(order.id, <id de transacción>)` — la misma rutina idempotente que usan el admin y el IPN de Yappy. | Invariante de emisión independiente del proveedor. Webhook + retorno + reintentos pueden llegar varias veces sin duplicar nada. |
| D6 | Referencia de la orden | Reusar `orders.order_ref` (mismo generador que Yappy, `assignNewOrderRef`). ID de transacción de Tilopay en columna nueva `tilopay_transaction_id`; el código de autorización en `payment_ref`. | Mismo patrón que `yappy_transaction_id` (0002). Hace falta el ID para reembolsar y para conciliar contra el estado de cuenta. |
| D7 | Reserva | `RESERVATION_MINUTES.tilopay = 20`. | Pago síncrono como Yappy (15 min) + margen por 3-D Secure y redirect. |
| D8 | Comisión | `PAYMENT_FEES.tilopay = { pct: 0.0375, fixedCents: 50, minFeeCents: 0 }` en `pricing.ts` **y** su espejo en `src/shared/config.ts`. Si la comisión lleva ITBMS encima **(P5)**, se ajusta `pct`/`fixedCents` antes de abrir venta. | Gross-up por transacción igual que hoy: la banda recibe el precio base. |
| D9 | Habilitación | Igual que Yappy: si faltan las variables `TILOPAY_*`, la opción se oculta sola (`GET /api/tilopay/config` → `{ enabled }`). **No** van a `REQUIRED_SECRETS` de `release-cloudflare.mjs`: la API funciona sin ellas. | Despliegue gradual sin romper nada. |
| D10 | Convivencia con CuantoApp | La opción "Tarjeta" del comprador usa **Tilopay si está habilitado; si no, CuantoApp** (nunca las dos a la vez). El admin conserva "marcar pagada" para órdenes `cuantoapp` pendientes. CuantoApp se retira en la Fase 3. | Respaldo inmediato si Tilopay falla en producción: vaciar una variable y redeployar. |
| D11 | Retorno del comprador | La URL de retorno es `/entradas` de su evento con `?orden=<uuid>&tilopay=retorno`. La app reabre la confirmación de esa orden, llama a `POST /api/tilopay/confirm` y luego sondea el estado (mismo patrón que `YappyCheckout`). | Si el webhook se atrasa o no llega, el retorno del comprador ya verifica. La orden pendiente sobrevive a un refresh (como `sl.pendingYappyOrder.<slug>`). |
| D12 | Pago sobre orden cancelada | Si Tilopay confirma un pago de una orden ya `cancelled` (reserva vencida + limpieza), **no se emite**: `console.error` + la orden aparece en el admin para reembolso o emisión manual. | Mismo criterio que `api/yappy/ipn.ts`. Con D13 debería ser rarísimo. |
| D13 | Limpieza | Antes de cancelar una orden `tilopay` vencida, el cron de limpieza consulta su estado en Tilopay; si está aprobada, la emite en vez de cancelarla. | Evita D12 en el caso típico (webhook perdido + comprador que cerró la pestaña). Sigue siendo housekeeping: el cupo se libera por timestamp igual que hoy. |

## Flujo

```
Comprador            /entradas            Worker (api/)                    Tilopay
   │ elige "Tarjeta"     │                     │                              │
   │────────────────────▶│ POST /api/orders    │ create_order (method=tilopay,│
   │                     │────────────────────▶│ total por pricing.ts, 20 min)│
   │                     │ POST /api/tilopay/  │                              │
   │                     │   create-payment    │ login → processPayment       │
   │                     │────────────────────▶│ (amount=total_cents, USD,    │
   │                     │                     │  orderNumber=order_ref,      │
   │                     │◀──── { redirectUrl }│  returnUrl=/entradas?orden=…)│
   │◀── location.assign ─│                     │─────────────────────────────▶│
   │──────────────── paga en la página de Tilopay (3DS / Apple Pay) ─────────▶│
   │                     │                     │◀──── webhook (P1) ───────────│
   │                     │                     │ verify(order) ──consulta────▶│
   │                     │                     │ aprobado + monto OK → issueOrder
   │◀──────────── redirect a returnUrl ───────────────────────────────────────│
   │                     │ POST /api/tilopay/confirm → verify(order) (idempotente)
   │                     │ sondea /api/orders/<id>/status hasta `paid` → "Revisa tu correo"
```

`verify(order)` vive en `api/_lib/tilopay.ts` y es la **única** función que
decide emitir: consulta la transacción por `order_ref` en la API de Tilopay,
aplica D4 y llama `issueOrder`. La usan el webhook, `confirm` y la limpieza.

## Cambios

### Base de datos — `supabase/migrations/0019_tilopay.sql`

- `orders.payment_method` check: agregar `'tilopay'` (mismo patrón que 0003/0008).
- `alter table orders add column tilopay_transaction_id text;`
- `report_settlement` (0018) tiene columnas fijas por método (`net_yappy`,
  `net_cuantoapp`, `net_cash`): agregar `net_tilopay`, y revisar las demás
  `report_*` que filtren por método. Ajustar `api/_lib/reports.ts`
  (`netByMethod`, CSV, HTML imprimible) y `src/admin/ReportesTab.tsx`.

### Backend

| Archivo | Qué |
|---|---|
| `api/_lib/tilopay.ts` (nuevo) | Cliente: `isTilopayConfigured()`, login con caché del token por la vida del isolate, `createPayment(order)`, `getTransaction(orderRef)` **(P1)**, `verify(order)` (D3–D5, D12). Solo server. |
| `api/tilopay/config.ts` (nuevo) | `GET` → `{ enabled }`. |
| `api/tilopay/create-payment.ts` (nuevo) | `POST { orderId }`. El UUID es la capacidad (como `yappy/create-order`). Solo órdenes `pending` y `tilopay`. Asigna `order_ref` si falta. Devuelve `{ redirectUrl }`. |
| `api/tilopay/webhook.ts` (nuevo) | Recibe el aviso **(P1)**, autenticado con lo que Tilopay ofrezca (firma) y, como mínimo, un token en la URL (`?k=<TILOPAY_WEBHOOK_TOKEN>`, comparación timing-safe). Ignora el contenido salvo la referencia y llama `verify`. Responde 200 aunque no emita (no provocar reintentos infinitos). |
| `api/tilopay/confirm.ts` (nuevo) | `POST { orderId }` desde la página de retorno → `verify`. Rate-limit implícito: no-op si la orden ya no está `pending`. |
| `cloudflare/worker.ts` | Registrar las 4 rutas (no hay routing por archivos). |
| `cloudflare/adapter.ts` | Nada si el webhook no exige headers especiales. |
| `api/_lib/pricing.ts` + `src/shared/config.ts` | D7, D8. |
| `api/_lib/types.ts` | `PaymentMethod` += `'tilopay'`. |
| Limpieza (`/api/admin/orders/cleanup`) | D13. |
| `api/_lib/refund.ts` | Fase 1: `tilopay` cae en el camino manual existente. Fase 2: reverso por API **(P4)**. |

Variables del Worker (`wrangler secret`, documentar en `ticket-system/README.md`
y `.env.example`): `TILOPAY_API_USER`, `TILOPAY_API_PASSWORD`,
`TILOPAY_API_KEY` (clave de integración), `TILOPAY_WEBHOOK_TOKEN`
(`openssl rand -hex 16`).

### Frontend

- `src/shared/config.ts` — `PAYMENT_METHODS`: la entrada de tarjeta resuelve a
  `tilopay` o `cuantoapp` según `GET /api/tilopay/config` (D10). Etiqueta
  "Tarjeta (Visa, Mastercard, Amex, Apple Pay, Google Pay)" — Apple/Google
  solo si **(P3)** se confirma.
- `src/entradas/App.tsx` — nuevo `TilopayCheckout`: botón "Pagar con tarjeta"
  → `create-payment` → redirect. Al volver (`?tilopay=retorno`): `confirm` +
  sondeo, con estados "Confirmando tu pago…", "Pago confirmado — revisa tu
  correo", "No se completó el pago — puedes intentar de nuevo" (mientras la
  reserva siga viva) y "Tu reserva venció". Persistir la orden pendiente en
  `localStorage` como Yappy.
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

Con D2 (redirect por navegación) **no hace falta cambiar** `script-src`,
`frame-src` ni `connect-src`: las llamadas a la API de Tilopay son
server-side. Solo si el redirect fuera por `<form method="post">` se agrega el
dominio de Tilopay a `form-action`. Si se pasa al SDK embebido (Fase 1b), sí
habría que agregar sus dominios en `script-src`/`connect-src`/`frame-src`.

## Criterios de aceptación

1. Con las variables `TILOPAY_*` vacías, `/entradas` se ve y funciona como hoy
   (tarjeta = CuantoApp).
2. Con Tilopay habilitado, una compra con tarjeta aprobada en sandbox **(P2)**
   termina en `paid`, con entradas emitidas y correo enviado, sin tocar el
   admin.
3. El monto cobrado por Tilopay es exactamente `orders.total_cents`; el cliente
   no envía montos a ningún endpoint.
4. Un webhook falsificado (token incorrecto o referencia de una transacción no
   aprobada) no cambia ninguna orden.
5. Webhook + retorno + limpieza procesando la misma orden emiten **una sola
   vez** (un correo, N entradas).
6. Una transacción aprobada por un monto distinto al de la orden **no** emite y
   deja un `console.error` con `order_id` y montos.
7. Si el comprador cierra la pestaña tras pagar y el webhook no llega, la
   limpieza emite la orden en vez de cancelarla (D13).
8. Un pago rechazado deja la orden `pending`; el comprador puede reintentar
   mientras la reserva siga viva, y el cupo se libera a los 20 min.
9. El cierre en Reportes muestra el neto de Tilopay separado de CuantoApp, y la
   comisión estimada usa 3.75% + $0.50 por orden.
10. Ningún secreto `TILOPAY_*` aparece en el bundle del cliente ni en
    respuestas de la API.
11. `npm run typecheck` pasa.

## Fases

| Fase | Alcance | Salida |
|---|---|---|
| 0 | Resolver P1–P5 con Tilopay; abrir cuenta y sandbox. | Respuestas anotadas en este spec. |
| 1 | Todo lo de "Cambios" salvo reembolso por API. Probar en sandbox → producción con una compra real de $1 en un evento de prueba temporal (`on_sale`, sin enlazar; se archiva después). | Tarjeta automática en el próximo evento, CuantoApp como respaldo (D10). |
| 1b | Solo si P3 = "la página alojada no trae Apple/Google Pay": evaluar el SDK embebido (CSP, verificación de dominio de Apple Pay). | Decisión documentada. |
| 2 | Reembolso por API en `refund.ts` **(P4)**. | Botón de reembolso del admin sin paso manual para `tilopay`. |
| 3 | Tras un evento completo sin incidentes: retirar CuantoApp (`cuantoapp.ts`, `CuantoappTab`, `CUANTOAPP_PAYMENT_URL_*`, copy). El valor `cuantoapp` se queda en el check de la BD (órdenes históricas). | Un solo flujo de tarjeta. |

## Preguntas abiertas

| # | Pregunta | A quién | Bloquea |
|---|---|---|---|
| P1 | Contrato del webhook de `processPayment`: payload, cómo se firma o autentica, reintentos. Y el endpoint para **consultar una transacción por número de orden** (base de `verify`). La documentación pública dice que se entrega a pedido. | sac@tilopay.com | Fase 1 |
| P2 | Sandbox: cómo probar sin cobrar (según la doc, el modo se cambia en la cuenta, sin host aparte), tarjetas de prueba, si los webhooks salen desde sandbox. | Tilopay | Fase 1 (pruebas) |
| P3 | ¿La página de pago alojada ofrece Apple Pay y Google Pay, o solo el SDK? ¿Aplica 3-D Secure siempre? | Tilopay | Copy de la Fase 1; Fase 1b |
| P4 | ¿Reembolsos/reversos por API? ¿Parciales? ¿Costo? | Tilopay | Fase 2 |
| P5 | ¿La comisión de 3.75% + $0.50 lleva ITBMS encima? ¿Plazo y forma de depósito; hay contracargos con costo? | Asesor comercial | D8 antes de abrir venta |
| P6 | Requisitos de afiliación para la banda (persona natural vs. jurídica, cuenta bancaria en Panamá). | Banda + Tilopay | Fase 0 |

## Riesgos

- **Contrato del webhook desconocido (P1).** Mitigado por D3: aunque el
  webhook sea pobre, `confirm` + D13 garantizan la emisión verificando contra
  la API. Si **no** existe consulta de transacción por API, el diseño entero
  se cae → reevaluar antes de construir.
- **Comisión con ITBMS (P5)** podría dejar a Tilopay más caro que CuantoApp en
  órdenes de 1 entrada. Aceptable: el motivo es la automatización, pero hay que
  saberlo antes de fijar `PAYMENT_FEES`.
- **Proveedor nuevo en producción.** Mitigado por D9/D10 (respaldo a
  CuantoApp sin cambiar código) y la prueba de $1 en un evento de prueba.
