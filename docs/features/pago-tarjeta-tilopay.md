# Pago con tarjeta vía Tilopay (reemplaza los links de CuantoApp)

> Subsistema: `ticket-system/`. Agrega un método de pago con tarjeta
> **automático** (Tilopay) que reemplaza el flujo manual de CuantoApp. Yappy no
> se toca.

## Estado: borrador (15 nov 2026)

No implementado. Fuentes revisadas el 15 nov 2026: los Términos y Condiciones y la
política de privacidad de Tilopay para Panamá, la OpenAPI pública
(`tilopay.com/developers/openapi.json`) y el portal de desarrolladores completo
(`tilopay.com/llms.txt` → texto completo, páginas con `last_verified` entre ago y
oct 2026). Resolvieron lo que bloqueaba el diseño: hay consulta de transacción
por número de orden (`consult`), reembolso por API (`processModification`),
cuenta de pruebas propia y tarjetas de prueba. Quedan abiertas P3b (Apple/Google
Pay en la página alojada), P5 (retenciones y costos en Panamá), P6 (afiliación)
y P7 (dirección de facturación). Lo que dependa de ellas está marcado con
**(P#)**.

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
modo (producción/prueba) **se cambia en la cuenta del comercio**, no por host ni
por parámetro. Convenciones que rompen integraciones tipadas (portal,
"Convenciones" y "Cómo leer una respuesta de error"):

- **HTTP 200 no significa éxito**: conviven errores 4xx y 200 con el error en el
  cuerpo, con cinco envolturas distintas según el endpoint. Siempre mirar el
  cuerpo.
- `type`/`status` pueden venir como número **o** texto → normalizar con `String()`.
- Los montos vienen como **cadena** (`"12.99"`) → convertir a centavos sin punto
  flotante.
- El API **no es idempotente** y `orderNumber` es **único para siempre por
  comercio**: repetirlo da "Transacción duplicada" (un rechazo, no la
  transacción original). Ante un timeout, `consult` antes de reintentar.
- Los tokens **no se pueden revocar**: una fuga se trata como incidente y se
  rotan credenciales con Tilopay.

| Endpoint | Para qué | Notas |
|---|---|---|
| `POST /api/v1/login` `{ apiuser, password }` | Token bearer | `expires_in: 86400` (24 h). |
| `POST /api/v1/processPayment` | Crea la transacción de la página alojada | Body: `key`, `amount` (string `"12.99"`), `currency: "USD"`, `orderNumber`, `capture: "1"`, `redirect` (URL GET de retorno), `billTo*` (todos requeridos, P7), `subscription: "0"`, `platform`, `returnData` (base64), `token_version: "v2"`. Respuesta `{ type: "100", url }` → redirigir al comprador a `url`. Tiene webhook, pero su especificación se entrega solo abriendo un caso en soporte, **se envía una sola vez** (sin reintentos) y no tiene verificación de origen pública (ver D13). |
| Redirect de retorno (GET) | Vuelve el comprador | Query: `code` (`1` = aprobada), `description`, `auth`, `order`, `tilopay-transaction`, `OrderHash`, `returnData`. El algoritmo de `OrderHash` no es público (se pide a soporte) → **no lo usamos**: verificamos con `consult`. |
| `POST /api/v1/consult` `{ key, orderNumber }` | **Fuente de verdad** del pago | Devuelve un **arreglo** de transacciones de esa orden: `id_tilopay`, `amount`, `currency`, `code` (`"1"` = pago aprobado, `"1101"` = reembolso), `auth`, `type` (`"Payment"`…), `environment` (`"Test"`/`"Production"`), y el desglose `commission`, `iva_commission`, `retention_iva`, `retention_rent`, `cost`, `cost_iva`, `net_to_liquidate`. El portal manda usarlo antes de entregar el producto. |
| `POST /api/v1/processModification` `{ key, orderNumber, type, amount }` | Reembolso (`type: "2"`) o reverso (`"3"`) | `type: "100"` = se procesó; resultado en `ReasonCode` (`"1101"` = aprobado). El monto nunca puede superar el de la venta. |
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
| D2 | Modo de integración | **Página de pago alojada** (`processPayment` → redirect), no el SDK embebido. Fase 1 = **solo tarjeta** (Visa, Mastercard, Amex). Apple Pay se evalúa en la Fase 1b con el SDK (ver P3). | Los datos de tarjeta nunca tocan nuestro dominio (alcance PCI mínimo), CSP sin cambios y sin script de terceros en `/entradas`. El SDK, en cambio, se carga de una URL **mutable sin versión fija ni SRI** (`app.tilopay.com/sdk/v2/sdk_tpay.min.js`) y exige 6 dominios nuevos en la CSP: un costo de seguridad que solo se justifica si Apple Pay mueve la conversión. |
| D3 | Fuente de verdad del pago | **`consult` por `orderNumber`**, nunca los parámetros del redirect (`code`, `OrderHash`) ni ningún aviso entrante. El retorno del comprador y la conciliación periódica (D13) solo disparan una verificación server-side. | Mismo principio del IPN de Yappy (nada se emite sin verificar). Evita depender del algoritmo privado de `OrderHash`. |
| D4 | Condición para emitir | Entre las transacciones de **todos los intentos** de la orden (D6), **alguna** con `String(code) === "1"`, `type === "Payment"`, `amount` (cadena → centavos) == `orders.total_cents`, `currency === "USD"` y **`environment` == el esperado** (`TILOPAY_ENV`, comparando sin distinguir mayúsculas: `consult` dice `"Production"`/`"Test"` y `Init()` dice `"PROD"`/`"TEST"`), y **ningún** reembolso (`code === "1101"`) sobre ella. Si hay una aprobada pero algo no cuadra: no emitir, `console.error` y dejar la orden para revisión humana. | `consult` devuelve un arreglo (intentos rechazados, aprobados y reembolsos). El chequeo de `environment` es **crítico**: el portal advierte que, al compartir host, se puede creer que se está en pruebas y estar en producción (o al revés). Con D4 una tarjeta de prueba nunca emite entradas reales. |
| D5 | Emisión | `issueOrder(order.id, <auth>)` — la misma rutina idempotente que usan el admin y el IPN de Yappy. | Invariante de emisión independiente del proveedor. Retorno + conciliación pueden verificar la misma orden varias veces sin duplicar nada. |
| D6 | `orderNumber` | **Uno por intento**: `<order_ref>-<n>`, con `n` = columna nueva `orders.tilopay_attempts` (se incrementa **y persiste antes** de llamar a `processPayment`). Máximo 3 intentos por orden (D18). `verify` consulta los números `1..n`. `create-payment` primero corre `verify`: si un intento anterior ya está aprobado, emite y no abre otro. Al emitir se guardan el `orderNumber` aprobado en `tilopay_order_number`, `id_tilopay` en `tilopay_transaction_id`, `auth` en `payment_ref` y `net_to_liquidate` en `processor_net_cents` (D14). | `orderNumber` es único para siempre y repetirlo es un rechazo, así que un reintento tras un pago rechazado necesita uno nuevo. Pero si solo se guardara el último, un pago hecho en una pestaña vieja (intento 1) después de abrir el intento 2 no se vería: se cobra y no se emite. Consultar todos los intentos lo cubre. Persistir antes de llamar permite consultar tras un timeout, como pide el portal. |
| D7 | Reserva | `RESERVATION_MINUTES.tilopay = 20`. | Pago síncrono como Yappy (15 min) + margen por 3-D Secure y redirect. |
| D8 | Comisión | `PAYMENT_FEES.tilopay = { pct: 0.0375, fixedCents: 50, minFeeCents: 0 }` en `pricing.ts` **y** su espejo en `src/shared/config.ts`. Si en Panamá se descuenta ITBMS sobre la comisión o hay retenciones **(P5)**, se ajusta `pct`/`fixedCents` antes de abrir venta para que el neto liquidado siga ≥ precio base. | Gross-up por transacción igual que hoy: la banda recibe el precio base. `consult` confirma que el desglose existe (`iva_commission`, `retention_*`, `cost_iva`). |
| D8b | Costo del depósito | La transferencia ACH de cada liquidación a la cuenta de la banda cuesta **$2 por depósito** (dato de la banda, 15 nov 2026; falta confirmar si lleva `transfer_iva` encima). **No** entra en `PAYMENT_FEES`: es por depósito, no por orden, y la banda lo absorbe. El cierre de Reportes lo muestra como línea aparte (`depósitos × $2`, cantidad de depósitos ingresada a mano o leída del historial de liquidaciones si se integra después). | Repartirlo por orden exigiría adivinar cuántas órdenes caen en cada liquidación. Con depósitos semanales durante ~4 semanas de venta son ~$8 por evento (≈ $0.08 por orden con 100 órdenes con tarjeta): no justifica complicar el gross-up. Pedir la liquidación menos frecuente posible (P5) lo reduce. |
| D9 | Habilitación | Igual que Yappy: si faltan las variables `TILOPAY_*`, la opción se oculta sola (`GET /api/tilopay/config` → `{ enabled }`). **No** van a `REQUIRED_SECRETS` de `release-cloudflare.mjs`: la API funciona sin ellas. | Despliegue gradual sin romper nada. |
| D10 | Convivencia con CuantoApp | La opción "Tarjeta" del comprador usa **Tilopay si está habilitado; si no, CuantoApp** (nunca las dos a la vez). El admin conserva "marcar pagada" para órdenes `cuantoapp` pendientes. CuantoApp se retira en la Fase 3. | Respaldo inmediato si Tilopay falla en producción: vaciar una variable y redeployar. |
| D11 | Retorno del comprador | `redirect` = `/entradas` de su evento con `?orden=<uuid>&tilopay=retorno`; `returnData` = base64 del UUID (respaldo si se pierde el query). La app reabre la confirmación, llama a `POST /api/tilopay/confirm` y sondea `/api/orders/<id>/status` (mismo patrón que `YappyCheckout`). | El retorno verifica de inmediato en el caso normal. La orden pendiente sobrevive a un refresh (como `sl.pendingYappyOrder.<slug>`). |
| D12 | Pago sobre orden cancelada | Si `consult` muestra un pago aprobado de una orden ya `cancelled`, **no se emite**: `console.error` + la orden aparece en el admin para reembolso (D15) o emisión manual. | Mismo criterio que `api/yappy/ipn.ts`. Con D13 debería ser rarísimo. |
| D13 | Conciliación por cron (en vez del webhook) | Nuevo cron **cada 5 min** en `wrangler.jsonc`: toma órdenes `tilopay` `pending` creadas en las últimas 24 h y llama `verify` a cada una. Además, la limpieza diaria verifica con `consult` antes de cancelar una orden `tilopay` vencida. El webhook de `processPayment` queda fuera de la Fase 1. | El webhook de compras **se envía una sola vez** (cualquier respuesta que no sea 200 se pierde), su contrato hay que pedirlo a soporte y su única verificación de origen es un `orderHash` de algoritmo privado: no sirve como fuente de verdad ni como única red. El cron cubre al comprador que paga y cierra la pestaña: recibe su QR en ≤ 5 min. Con 20 min de reserva son ~4 consultas por orden abandonada. Si después se quiere bajar la espera, el webhook se agrega como disparador de `verify`, nunca como prueba de pago. |
| D14 | Neto real | Columna `orders.processor_net_cents` con `net_to_liquidate` de `consult` (solo `tilopay` por ahora). El cierre de Reportes usa el neto real cuando existe y la estimación de `estimateProcessorFeeCents` cuando no. | Hoy la comisión del cierre es una estimación (`reportes-admin.md`, D5); Tilopay da el dato exacto, incluidas retenciones. |
| D15 | Reembolsos | `refund.ts` llama a `processModification` (`type: "2"`, monto completo, `orderNumber` = `tilopay_order_number`) para órdenes `tilopay`, con el mismo contrato que Yappy: éxito solo con `type: "100"` **y** `ReasonCode: "1101"`; si no, no toca la BD y el admin puede caer al reembolso manual. Pasados **60 días** desde el cobro, Tilopay ya no permite reembolsar: el admin muestra "solo reembolso manual" y no llama al API. El diálogo de reembolso avisa el costo: la comisión original **no se devuelve** y se cobran **$0.35** adicionales por reembolso (T&C Panamá, §4). | Elimina el paso manual también al reembolsar. Hoy la política es "todas las compras son finales" (`/entradas`, `/ayuda`), así que esto cubre sobre todo cancelaciones de evento y errores. Reverso (`"3"`) solo si Tilopay indica que aplica antes de liquidar **(P4)**. |
| D17 | Dirección de facturación | Con método `tilopay`, el formulario de `/entradas` pide **dirección, ciudad y provincia** (selector con los códigos ISO de Panamá: `PA-1`…`PA-10`, comarcas) y **país** (por defecto Panamá; otros países, campo de estado libre). El teléfono pasa a ser obligatorio con tarjeta (`billToTelephone` es requerido). Esos datos **se envían a Tilopay y no se guardan** en nuestra BD; viven solo en la sesión del navegador mientras la orden esté pendiente, para reintentos. Código postal: lo que Tilopay acepte (P7). | Los T&C de Panamá (§2) obligan al comercio a enviar "en todo momento" el correo y la **dirección física de facturación** del cliente, para prevención de fraude: mandar valores fijos incumpliría el contrato. No guardarlos evita sumar datos personales que no necesitamos (ya hay correo, nombre y teléfono). |
| D18 | Protección contra pruebas de tarjetas | Máximo **3** intentos por orden (no 5). Límite de intentos `tilopay` por IP y por correo (p. ej. 5/h) en `create-payment`. Si aun así hay ataques, agregar Cloudflare Turnstile antes de `create-payment`. Alerta (`console.error` + reporte) si la tasa de rechazos del día supera 10%. | Los T&C (§10) permiten **restringir la cuenta con 20% de transacciones denegadas en 30 días**. Con nuestro volumen (decenas de órdenes por evento), un bot probando tarjetas robadas llega a ese 20% en minutos y nos bloquea en plena venta. |
| D19 | Cumplimiento visible al comprador | (a) Junto al botón "Pagar con tarjeta": "Tu pago lo procesa Tilopay" con enlace a su política de privacidad. (b) La política "todas las compras son finales" que ya muestra `/entradas` se mantiene **antes** del pago (también sirve como evidencia ante reclamos). (c) La afiliación declara el dominio exacto `entradas.still-louder.com` y la actividad "venta de entradas a conciertos de la banda". | Los T&C exigen que el comercio obtenga la autorización del cliente para que Tilopay trate sus datos (su política incluye **usarlos para su propia publicidad y perfiles de consumo**), que tenga publicadas sus políticas de devolución, y castigan vender bajo otro nombre o desde un dominio distinto al contratado (§2, §6, §11). |
| D20 | Evidencia para reclamos | En `/admin`, por orden `tilopay`: "Exportar evidencia" (PDF/HTML imprimible con orden, montos, fecha y hora del pago, `auth`, correo de entrega enviado, entradas emitidas y **hora de check-in** de cada una, y el texto de la política aceptada). Fase 2. | Un reclamo cuesta **$75 de penalidad** (no reembolsable aunque se gane), retiene el monto en disputa y da **3–5 días hábiles** para responder; pasar a arbitraje cuesta ≥ $500. Más de 3 reclamos en 30 días, o más de 1% de reclamos sobre ventas dos meses seguidos, permite a Tilopay cancelar la afiliación (§4, §11). El check-in en puerta es la mejor prueba de servicio entregado, y ya lo tenemos. |
| D16 | Cuentas | **Cuenta de desarrollador** (registro en `tilopay.com/developers/registro`, Tilopay habilita una cuenta de pruebas con credenciales propias) para desarrollo y staging; **cuenta de la banda** solo en producción. Nunca se alterna el modo de la cuenta de producción para probar. | El modo es de toda la cuenta: probar en la de producción la deja sin cobrar de verdad mientras dura la prueba. Con dos cuentas, `TILOPAY_ENV` es fijo por despliegue. |

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
- `alter table orders add column tilopay_attempts smallint not null default 0, add column tilopay_order_number text, add column tilopay_transaction_id text, add column processor_net_cents integer;`
- Índice parcial para el cron: `on orders (created_at) where payment_method = 'tilopay' and status = 'pending'`.
- `report_settlement` (0018) tiene columnas fijas por método (`net_yappy`,
  `net_cuantoapp`, `net_cash`): agregar `net_tilopay` y el neto real (D14), y
  revisar las demás `report_*` que filtren por método. Ajustar
  `api/_lib/reports.ts` (`netByMethod`, CSV, HTML imprimible) y
  `src/admin/ReportesTab.tsx`.

### Backend

| Archivo | Qué |
|---|---|
| `api/_lib/tilopay.ts` (nuevo) | Cliente: `isTilopayConfigured()`, `login()` con caché del token por isolate según el `expires_in` que devuelve (hoy 24 h) y reintento ante 401, `createPayment(order)`, `consult(orderNumber)`, `refund(order)`, `verify(order)` (D3–D6, D12). Decide éxito/error **por el cuerpo**, tolera las distintas envolturas de error, normaliza `type`/`code` con `String()`, convierte montos cadena↔centavos sin flotantes. Guarda la respuesta cruda de cada rechazo en el log. Solo server. |
| `api/tilopay/config.ts` (nuevo) | `GET` → `{ enabled }`. |
| `api/tilopay/create-payment.ts` (nuevo) | `POST { orderId }`. El UUID es la capacidad (como `yappy/create-order`). Solo órdenes `pending` y `tilopay`. Corre `verify` primero; si no hay pago, abre el intento `n+1` (D6, `409 too_many_attempts` pasado el máximo). Ante timeout de `processPayment`, `consult` de ese número antes de responder. Devuelve `{ url }`. |
| `api/tilopay/confirm.ts` (nuevo) | `POST { orderId }` desde la página de retorno → `verify`. No-op si la orden ya no está `pending`. Ignora los parámetros del redirect. |
| `cloudflare/worker.ts` | Registrar las 3 rutas. `scheduled()` distingue el cron diario (limpieza) del de 5 min (conciliación: `/api/admin?path=orders/reconcile-tilopay`, autenticado con `CRON_SECRET` como la limpieza). |
| `wrangler.jsonc` | `triggers.crons`: agregar `"*/5 * * * *"`. |
| `api/admin.ts` | Ruta `orders/reconcile-tilopay` (cron) y, en la limpieza, `verify` antes de cancelar órdenes `tilopay`. |
| `api/_lib/pricing.ts` + `src/shared/config.ts` | D7, D8. |
| `api/_lib/types.ts` | `PaymentMethod` += `'tilopay'`. |
| `api/_lib/refund.ts` | D15. |

Variables del Worker (`wrangler secret`, documentar en `ticket-system/README.md`
y `.env.example`): `TILOPAY_API_USER`, `TILOPAY_API_PASSWORD`,
`TILOPAY_API_KEY` (clave de integración, panel → "Integración con
plataformas"), y la var `TILOPAY_ENV` = `Production` | `Test` (D4, D16). Las
credenciales son las mismas en ambos modos de una cuenta: lo que separa pruebas
de producción es usar otra cuenta (D16).

### Frontend

- `src/shared/config.ts` — `PAYMENT_METHODS`: la entrada de tarjeta resuelve a
  `tilopay` o `cuantoapp` según `GET /api/tilopay/config` (D10). Etiqueta
  "Tarjeta (Visa, Mastercard, Amex)". Apple Pay / Google Pay solo si se
  confirman (P3b) o llega la Fase 1b.
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
- Formulario de `/entradas` con tarjeta: campos de facturación de D17 y aviso
  de D19.
- Textos al comprador: `src/ayuda/App.tsx` y `src/como-comprar/App.tsx`
  mencionan CuantoApp; actualizar cuando Tilopay esté activo (`/como-comprar`
  cita las etiquetas del formulario — mantenerlas en sync, incluidos los campos
  nuevos de D17).
- Analytics: eventos de cliente `tilopay_redirect` y `tilopay_return`
  (`{ result }`), sin PII. `purchase` sigue saliendo del servidor desde
  `issue.ts`.

### CSP (`ticket-system/public/_headers`)

Sin cambios: el redirect es una navegación (`location.assign`) y todas las
llamadas a `app.tilopay.com` son server-side. Si se pasa al SDK embebido (Fase
1b), el portal pide permitir `app.tilopay.com`, `api.tokenex.com`,
`h.online-metrix.net`, `storage.googleapis.com`, `cdn.jsdelivr.net` y, para Apple
Pay, `applepay.cdn-apple.com` (en `script-src`/`connect-src`/`frame-src` según
corresponda).

## Criterios de aceptación

1. Con las variables `TILOPAY_*` vacías, `/entradas` se ve y funciona como hoy
   (tarjeta = CuantoApp).
2. Con la cuenta de desarrollador (`TILOPAY_ENV=Test`), una compra con
   `4111111111111111` (aprobada, sin fricción) y otra con `4012000000020071`
   (aprobada con challenge 3DS, código `3ds2`) terminan en `paid`, con entradas
   emitidas y correo enviado, sin tocar el admin.
2b. Una compra con `4012000000020121` (rechazada) deja la orden `pending`; el
   reintento usa un `orderNumber` nuevo y, pagado con una tarjeta aprobada,
   emite.
2c. Abrir dos intentos y pagar el **primero** emite igual (D6).
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
14. Con tarjeta, no se puede pagar sin dirección, ciudad, provincia, país y
    teléfono, y esos datos no aparecen en ninguna tabla de Supabase.
15. Un cuarto intento de la misma orden devuelve `409 too_many_attempts`, y
    superar el límite por IP/correo devuelve `429` sin llamar a Tilopay.

## Fases

| Fase | Alcance | Salida |
|---|---|---|
| 0 | Registrar la cuenta de desarrollador (D16). Resolver P3b, P5–P7 con Tilopay; abrir la cuenta de la banda (P6). | Respuestas anotadas en este spec. |
| 1 | Todo lo de "Cambios", probado con la cuenta de desarrollador y las tarjetas de prueba → credenciales de la banda en producción → compra real de $1 en un evento de prueba temporal (`on_sale`, sin enlazar; se archiva después), **con la tarjeta de alguien que no sea titular de la afiliación** (los T&C, §5, prohíben pagar con tarjetas del propio comercio) → reembolsarla por API (cuesta la comisión + $0.35). | Tarjeta automática en el próximo evento, CuantoApp como respaldo (D10). |
| 1b | Apple Pay con el SDK, solo si la página alojada no lo trae (P3b) y vale el costo de D2. Requisitos del portal: cuenta en **producción** (en pruebas el botón no aparece: **no se puede probar antes de salir**), dominio exacto `entradas.still-louder.com` certificado vía caso de soporte, solo Safari en dispositivos Apple. La hoja de Apple Pay muestra país `CR` y la etiqueta "Tilopay: <comercio>". | Decisión documentada. |
| 2 | Tras un evento completo sin incidentes: retirar CuantoApp (`cuantoapp.ts`, `CuantoappTab`, `CUANTOAPP_PAYMENT_URL_*`, copy). El valor `cuantoapp` se queda en el check de la BD (órdenes históricas). | Un solo flujo de tarjeta. |

> El modo prueba/producción es de **toda la cuenta**: por eso las pruebas van en
> la cuenta de desarrollador y la de la banda queda siempre en producción (D16).

## Preguntas abiertas

| # | Pregunta | Estado |
|---|---|---|
| P1 | Webhook y consulta de transacción. | **Resuelta:** `consult` por `orderNumber` es la confirmación que manda el propio portal. El webhook de `processPayment` existe pero se pide a soporte, va una sola vez y no tiene verificación pública → fuera de la Fase 1 (D3, D13). |
| P2 | Sandbox. | **Resuelta:** cuenta de pruebas propia vía registro de desarrollador (D16); 27 tarjetas de prueba con resultado fijo (aprobada, rechazada, fondos insuficientes, CVV incorrecto, con y sin challenge 3DS; código del challenge `3ds2`). |
| P3 | Apple Pay / Google Pay. | **Parcial:** Apple Pay está documentado **solo para el SDK** (requisitos en la Fase 1b). Google Pay **no aparece** en la documentación de desarrolladores, pese a estar en la tabla de tarifas. |
| P3b | ¿La página alojada (`processPayment`) muestra Apple Pay o Google Pay? ¿Google Pay existe por API o solo en plugins? | Abierta — Tilopay. Decide si hace falta la Fase 1b. |
| P4 | Reembolsos por API. | **Resuelta:** `processModification` (`2` reembolso, `3` reverso; aprobado = `ReasonCode "1101"`) → D15. **Costo (T&C §4):** no se devuelve la comisión + $0.35 por reembolso; plazo máximo 60 días; parcial permitido. Falta: cuándo aplica reverso vs. reembolso. |
| P5 | En Panamá, ¿qué se descuenta además del 3.75% + $0.50? El ejemplo de `consult` (probablemente Costa Rica) liquida **$4.04 de $5.00**: comisión + IVA, `retention_iva`, `retention_rent`, costo + IVA. La liquidación además descuenta `transfer` + `transfer_iva`: **resuelto en parte, $2 por depósito ACH** (D8b); falta si lleva ITBMS. **Frecuencia:** la elige el comercio (T&C §1) → pedir la menos frecuente que ofrezcan. **Reclamos:** $75 por reclamo, ≥ $500 si va a arbitraje (D20). | Abierta en parte — asesor comercial. **Bloquea D8** antes de abrir venta: si hay retenciones, el gross-up tiene que cubrirlas o la banda recibe menos que el precio base. Los T&C remiten las tarifas al **contrato de afiliación**: pedirlo antes de firmar. |
| P6 | Requisitos de afiliación para la banda (persona natural vs. jurídica). | Abierta en parte — banda + Tilopay. **T&C §3:** la cuenta bancaria de los depósitos tiene que estar **a nombre de quien se afilia**; si se afilia un integrante como persona natural, el dinero llega a su cuenta personal. Hay KYC y se aprueba solo la actividad declarada. |
| P7 | Dirección de facturación. | **Resuelta en contra (T&C §2):** hay que enviar la dirección física real del cliente → D17. Falta: qué mandar como código postal en Panamá (casi nadie lo usa) y si la página alojada vuelve a pedir los datos. |
| P8 | ¿Se puede reusar el mismo `orderNumber` tras un intento rechazado? | **Resuelta:** no. Es único para siempre y repetirlo es "Transacción duplicada" → un número por intento (D6). Solo se puede reusar si `consult` muestra que el número nunca llegó a crear una transacción (timeout). |

## Riesgos

- **Retenciones en Panamá (P5).** Si aplican como en el ejemplo de `consult`,
  el costo efectivo puede ser bastante mayor que 3.75% + $0.50 y Tilopay
  quedaría más caro que CuantoApp. Hay que tener el número antes de fijar
  `PAYMENT_FEES`; D14 permite verificarlo con datos reales después.
- **Cuenta dejada en modo prueba.** Mitigado por D4 (chequeo de
  `environment`), D16 (la cuenta de producción no se alterna) y el criterio 3.
- **API sin idempotencia.** Mitigado por D6 (número por intento persistido
  antes de llamar, `verify` antes de abrir otro intento, consulta de todos los
  intentos).
- **Fuga de credenciales o token.** Los tokens no se pueden revocar; todo vive
  en secretos del Worker y nunca baja al navegador (el SDK de la Fase 1b usaría
  `loginSdk`, que dura 1 h).
- **Sin webhook.** Mitigado por D13 (cron de 5 min). Costo: hasta 5 min de
  espera para quien cierra la pestaña antes del redirect.
- **Proveedor nuevo en producción.** Mitigado por D9/D10 (respaldo a
  CuantoApp sin cambiar código) y la prueba de $1 con reembolso.
- **Cuenta inactiva entre shows.** Los T&C (§10) inhabilitan la afiliación
  tras **180 días sin transacciones**; reactivarla es una solicitud desde el
  portal con hasta 24 horas hábiles de respuesta (y quizá revalidación).
  Mitigación: agregar a la lista "Para el próximo evento" del README del
  ticket-system "verificar que Tilopay esté activo" **antes** de abrir venta;
  mientras tanto, D10 cae a CuantoApp.
- **Bloqueo o retención de fondos.** Tilopay puede retener fondos durante
  validaciones, congelar 3 meses una cuenta bloqueada y retener 30–120 días al
  cerrar la afiliación (§3, §9, §11). El dinero de un evento puede no llegar a
  tiempo para pagar venue y bandas: no comprometer pagos contra el depósito de
  Tilopay.
- **Rechazos y reclamos.** Ver D18 (20% de rechazos restringe la cuenta) y D20
  ($75 por reclamo; más de 3 en 30 días permite cancelar la afiliación).
- **Privacidad.** La política de Tilopay para Panamá permite usar los datos del
  comprador para publicidad propia de Tilopay y perfiles de consumo (§3), y cita
  la ley de datos de Costa Rica (Ley 8968), no la de Panamá (Ley 81 de 2019).
  Mitigado en parte por D17 (no enviamos más de lo exigido) y D19 (aviso al
  comprador); vale la pena preguntarlo en la afiliación.
