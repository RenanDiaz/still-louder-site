# Reportes del admin (ver + exportar)

> Subsistema: `ticket-system/`. Superficie: `/admin`, tab nuevo **Reportes**.
> Solo admin (`ADMIN_PASSWORD`); soporte y puerta no ven dinero.

## Estado: listo para implementar (1 nov 2026)

Preguntas de diseño resueltas (ver [Decisiones](#decisiones), D11–D13). Queda
una [pregunta abierta](#preguntas-abiertas) menor que no bloquea.

## Problema

El uso principal es el **cierre/liquidación** de cada show: cuadrar cuánto se
cobró, por qué método, cuánto debe haber depositado cada procesador, qué se
reembolsó y qué se regaló, y entregarlo impreso/PDF a la banda o al venue.
Secundariamente, seguir el ritmo de ventas y la asistencia, y comparar shows.

Hoy existe algo, pero no sirve para cerrar:

| Hoy | Problema |
|---|---|
| Tab **Resumen**: totales del evento (preventa, neto/bruto/recargos, neto por método, reembolsos, entradas por tarifa) | Solo en pantalla. Sin serie temporal, sin depósito esperado por procesador, sin export ni versión imprimible. |
| **Órdenes → Exportar CSV** | Exporta lo cargado en pantalla: `listOrders` hace `.limit(200)`. Con más de 200 órdenes el CSV sale **truncado sin aviso**, y respeta el filtro de estado/búsqueda activo. |
| **Entradas → Exportar CSV** | Igual, tope `.limit(1000)`. |
| Stats de `listOrders` / `listEvents` | Suman en JS filas traídas por PostgREST. El `paidOrders` de `listOrders` no tiene `.limit()` → hereda el `max_rows` del proyecto (1000 por defecto en Supabase) y truncaría el total en silencio. Hoy no muerde (aforo 230), pero es la base equivocada para un reporte de dinero. |
| `downloadCsv` (cliente) | No neutraliza inyección de fórmulas: un `buyer_name` como `=HYPERLINK(...)` se ejecuta al abrir en Excel. |

## Decisiones

| # | Decisión | Por qué / alternativa descartada |
|---|---|---|
| D1 | **Agregar en Postgres** con RPCs de solo lectura (migración `0018_reports.sql`); el Worker solo formatea. | Elimina el truncado de PostgREST y las sumas en JS; una sola definición de cada número. Descartado: seguir sumando en `admin.ts`. |
| D2 | Las definiciones de [Métricas](#métricas-definiciones-canónicas) son **canónicas**. El tab Resumen pasa a leer la misma RPC de cierre en este mismo cambio. | Dos fórmulas de "ingresos netos" en el mismo panel terminan dando números distintos. |
| D3 | **Zona horaria `America/Panama`** (UTC−5, sin horario de verano) para todo corte por día/hora, en SQL: `(ts at time zone 'America/Panama')`. | Una venta a las 9 p. m. no puede caer en el día siguiente. |
| D4 | El dinero se reconoce **por `paid_at`**; un reembolso resta **en el día de `refunded_at`**. | Así la suma de la serie diaria cuadra exacto con el cierre (que excluye las reembolsadas). Ojo: el efectivo cuenta el día en que el admin lo marca pagado, no cuando se cobró. |
| D5 | **Depósito esperado por procesador** = bruto − comisión estimada, calculada en TS con la tabla `PAYMENT_FEES` de `api/_lib/pricing.ts` (no se duplica en SQL). Rotulado "estimado". | Es el número a comparar contra el estado de cuenta de Yappy/CuantoApp. El recargo cobrado ≠ comisión exacta (redondeo hacia arriba por orden). |
| D6 | **Exports en el servidor**, sin tope (paginando de a 1000 con `.range()`), siempre del evento completo e ignorando los filtros de la pantalla. Los botones "Exportar CSV" de Órdenes y Entradas pasan a usarlos. | Arregla el truncado. A esta escala no hace falta streaming. |
| D7 | **CSV**: UTF-8 con BOM, separador `,`, montos en dólares con punto (`12.34`, sin `$`), fechas en hora de Panamá `YYYY-MM-DD HH:mm`. Cualquier celda que empiece con `= + - @` o tab/CR se prefija con `'`. | Excel es-PA abre bien con coma y punto decimal. El prefijo cierra la inyección de fórmulas (también en el `downloadCsv` actual hasta que se retire). |
| D8 | **Imprimible solo para el cierre**: HTML del servidor con botón "Imprimir / Guardar PDF", mismo patrón que el comprobante de reembolso (`receipt.ts` + `window.open` + `sl-print`). PDF = imprimir del navegador. | Cero dependencias. Un PDF generado en el Worker no aporta nada sobre "Guardar como PDF". |
| D9 | El cierre sale con marca **PRELIMINAR** mientras el evento no haya terminado (`now < event_end`) **o** haya órdenes `pending` vigentes. | Evita entregar como final un cierre que todavía cambia. |
| D10 | Gráficos con barras CSS, sin librería. | El bundle del admin no necesita Recharts para 3 barras. |
| D11 | **Comisión en reembolsos — regla del mismo día, para Yappy y CuantoApp**: si `refunded_at` cae el **mismo día de Panamá** que `paid_at`, el procesador devuelve la comisión (pérdida 0); si cae otro día, la comisión estimada de esa orden se **pierde**. Efectivo: nunca hay comisión. La regla vive en una sola función de `api/_lib/reports.ts` (`refundFeeLost(order)`) para poder cambiarla por método. | Yappy lo confirma así; para CuantoApp es un **supuesto sin verificar** (podría no devolverla nunca). Se aplica la misma regla por simplicidad, y el cierre lo rotula "estimado". Si se confirma lo contrario, se cambia solo esa función. |
| D12 | **Efectivo — sin desglose por cobrador.** El cierre lista las órdenes en efectivo con su nota (`payment_ref`) tal cual, rotulada "nota libre", para cuadrar a mano. No se agrupa por la nota. | La nota no es un campo fiable (mayúsculas, apodos, vacía); agruparla daría totales por cobrador falsamente precisos. Un campo estructurado de cobrador queda fuera de alcance. |
| D13 | **Sin snapshot del cierre en v1.** El imprimible lleva fecha/hora de generación y la marca PRELIMINAR (D9). | Basta para saber qué versión se entregó. Si un reembolso posterior cambia el cierre, se reimprime. |

## Alcance

1. **Cierre del evento** (pantalla + CSV + imprimible) — el núcleo.
2. **Ventas por día** (pantalla + CSV).
3. **Asistencia / check-in** (pantalla + CSV).
4. **Comparativo entre eventos** (pantalla + CSV).
5. **Exports de detalle** sin tope: órdenes y entradas del evento (reemplazan los
   CSV actuales).

## Métricas (definiciones canónicas)

Universo: órdenes/entradas con `event_id` = evento. Montos en centavos en BD.

| Métrica | Definición |
|---|---|
| Órdenes pagadas | `status = 'paid'` |
| Entradas vendidas | Σ `quantity` de pagadas con tier `preventa`/`general` |
| Cortesías / Regalos | Σ `quantity` de pagadas con tier `cortesia` / `regalo` (siempre $0; nunca cuentan como venta) |
| Bruto | Σ `total_cents` de pagadas (lo que pagó el comprador) |
| Recargo cobrado | Σ `fee_cents` de pagadas |
| Neto | Σ `net_cents` de pagadas (lo que debe recibir la banda) |
| Comisión estimada (por método) | Σ por orden de `max(pct × total + fijo, mínimo)` con `PAYMENT_FEES`; 0 para `cash`/`courtesy`/`gift` |
| Depósito esperado (por método) | Bruto del método − comisión estimada del método − comisión perdida por reembolsos del método |
| Comisión perdida por reembolsos | Σ comisión estimada de las órdenes `refunded` del método cuyo `refunded_at` (día Panamá) ≠ `paid_at` (día Panamá) — D11 |
| Neto final | Neto − comisión perdida por reembolsos (lo que efectivamente le queda a la banda) |
| Residuo de redondeo | Recargo cobrado − comisión estimada (debe ser ≥ 0 y de centavos) |
| Reembolsado | `status = 'refunded'`: n.º órdenes, Σ `quantity`, Σ `total_cents` devuelto. **Excluido** de bruto/neto. |
| Anuladas sin reembolso | Entradas `void` cuya orden sigue `paid` (revocadas a mano). El dinero sigue contando; se listan por transparencia. |
| Pendientes vigentes | `status = 'pending'` y `reservation_expires_at > now()`: n.º y Σ `total_cents` (dinero aún no cobrado; las de efectivo son el riesgo típico) |
| Emitidas | Entradas no `void` |
| Asistieron | Entradas `used` |
| No-show | Entradas `valid` después de `event_end` |
| Tasa de asistencia | Asistieron / Emitidas |
| Ocupación | Emitidas / `events.total_capacity` |
| Fecha de sold-out | Primer `paid_at` en que las entradas emitidas acumuladas alcanzan `total_capacity`; vacío si nunca |

## Reportes

### 1. Cierre del evento

Bloques (pantalla e imprimible iguales):

1. **Encabezado**: nombre, fecha y venue del evento, estado, "generado el …"
   (hora Panamá), marca PRELIMINAR si aplica (D9).
2. **Resumen**: entradas vendidas por tarifa (cantidad × precio unitario = neto),
   cortesías, regalos, emitidas, ocupación.
3. **Dinero por método** (`yappy`, `cuantoapp`, `cash`): órdenes, entradas,
   bruto, recargo, neto, comisión estimada, depósito esperado. Fila total.
4. **Reembolsos**: totales + lista (comprador, método, fecha de pago, fecha de
   reembolso, monto devuelto, "¿mismo día?", comisión perdida, `refund_ref`).
   Total de comisión perdida y **neto final**.
5. **Efectivo** (D12): lista de órdenes en efectivo pagadas (comprador,
   entradas, monto, fecha de pago, nota libre) con total; para cuadrar a mano.
6. **Excepciones**: anuladas sin reembolso; pendientes vigentes.
7. **Asistencia** (si el evento ya pasó): asistieron, no-show, tasa.
8. **Firmas** (solo imprimible): "Preparado por" / "Recibido por", con fecha.

CSV del cierre: una fila por (sección, concepto, método) con columnas
`seccion,concepto,metodo,ordenes,entradas,bruto,recargo,neto,comision_estimada,comision_perdida,deposito_esperado`.
Las listas (reembolsos, excepciones) van en el export de detalle de órdenes, no
aquí.

### 2. Ventas por día

Una fila por día (Panamá) desde el primer `created_at` del evento hasta
`min(hoy, sales_end)`, **incluyendo días en cero** (`generate_series`).

Columnas: fecha, órdenes pagadas, entradas preventa, entradas general,
cortesías+regalos emitidos (aparte, no son venta), bruto, neto, neto por método,
reembolsos del día (−), neto del día, entradas acumuladas, % de aforo acumulado.

Pantalla: tabla + barra CSS de entradas por día y línea de acumulado vs. aforo.
Invariante: Σ neto del día = neto del cierre.

### 3. Asistencia / check-in

- Llegadas por franja de **15 min** (`used_at`, Panamá), desde la primera hasta
  la última, con acumulado y % de emitidas.
- Por estación (`used_by`, texto libre de `/validar`): entradas validadas.
- Por tarifa: emitidas, asistieron, no-show, tasa.

Durante el show el tab **Check-in** sigue siendo la vista en vivo; esto es el
análisis posterior. No incluye escaneos rechazados (no se registran).

### 4. Comparativo entre eventos

No depende del evento seleccionado. Una fila por evento con status ≠ `draft`,
más reciente primero: nombre, fecha, status, aforo, vendidas (preventa/general),
cortesías+regalos, ocupación, neto, bruto, reembolsado, días en venta
(`presale_start` → `sales_end` o hoy), fecha de sold-out, tasa de asistencia
(solo si el evento ya pasó).

### 5. Exports de detalle

- **Órdenes** (todas las del evento, todos los estados): las columnas actuales +
  `id`, `order_ref`, `yappy_transaction_id`, `refunded_at`, `refund_ref`,
  `marketing_opt_in`.
- **Entradas** (todas): columnas actuales + `order_id`.

Contienen PII (correo/teléfono): solo admin, `Cache-Control: no-store`, nunca
se loguean.

## Base de datos — `supabase/migrations/0018_reports.sql`

Sin tablas nuevas. Funciones `stable`, `language sql`, solo lectura, con
`revoke execute … from public, anon, authenticated` (mismo patrón que 0017):

| RPC | Devuelve |
|---|---|
| `report_settlement(p_event_id uuid)` | Una fila por (status, tier, payment_method): n.º órdenes, Σ quantity, Σ total/net/fee. El TS arma bloques y comisiones. |
| `report_settlement_exceptions(p_event_id uuid)` | Filas cortas (sin PII más allá del nombre) de: reembolsadas (con método, `total_cents`, `paid_at`, `refunded_at`, `refund_ref` — el TS aplica D11), pagadas en efectivo (con `payment_ref`), anuladas-sin-reembolso y pendientes vigentes. |
| `report_sales_daily(p_event_id uuid)` | Serie diaria de D4/§2 con días en cero. |
| `report_checkin(p_event_id uuid, p_bucket_minutes int default 15)` | Franjas, por estación y por tarifa (o tres funciones; a criterio del implementador). |
| `report_events_comparison()` | Una fila por evento no `draft`. |

Índices: `orders(event_id, status)` y `tickets(event_id, status)` ya existen
(0011); no hacen falta nuevos.

## Endpoints (dentro de `api/admin.ts`, gated por `isAdmin`)

| Ruta | Respuesta |
|---|---|
| `GET /api/admin/reports/settlement?event=&format=json\|csv\|html` | Cierre. `html` = imprimible. |
| `GET /api/admin/reports/sales-daily?event=&format=json\|csv` | Ventas por día. |
| `GET /api/admin/reports/checkin?event=&format=json\|csv` | Asistencia. |
| `GET /api/admin/reports/events?format=json\|csv` | Comparativo (sin `?event=`, como `events`). |
| `GET /api/admin/reports/orders.csv?event=` | Detalle de órdenes, sin tope. |
| `GET /api/admin/reports/tickets.csv?event=` | Detalle de entradas, sin tope. |

- Sin archivo nuevo bajo `api/` → no hay que tocar el router de
  `cloudflare/worker.ts`. Agregar las rutas a la tabla de comentarios del
  inicio de `admin.ts`.
- `?event=` faltante → `400 event_required` (regla existente). `format`
  inválido → `400 invalid_format`.
- CSV: `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="<reporte>-<slug>-<YYYY-MM-DD>.csv"`
  (fecha de Panamá), `Cache-Control: no-store`.
- Formateo de CSV y del HTML imprimible en `api/_lib/reports.ts` (nuevo,
  server-only), reutilizando `escapeHtml`/formatos de `receipt.ts` (extraerlos a
  un helper compartido si hace falta).
- `listOrders` (stats del Resumen) pasa a construir `stats` desde
  `report_settlement` (D2); el shape de la respuesta no cambia.

## Panel admin — tab **Reportes**

- Tab nuevo entre **Check-in** y **CuantoApp**: sub-navegación **Cierre · Ventas
  por día · Asistencia · Comparativo**. Los tres primeros usan el evento
  seleccionado; Comparativo funciona sin evento (como Eventos/Campañas).
- Cada vista: botón **Exportar CSV**; Cierre además **Imprimir / PDF**.
- Descarga: `fetch` con el header `Authorization` → `Blob` → `<a download>`
  (no se puede usar un link directo: la contraseña va en header).
- Imprimible: el patrón de `handleReceipt` (abrir pestaña en blanco antes del
  `await`, escribir el HTML, enganchar `#sl-print` desde el opener por la CSP).
- Órdenes/Entradas: "Exportar CSV" llama al endpoint de detalle; se elimina el
  armado de CSV en el cliente (y con él `downloadCsv`, si nada más lo usa).
- Estados vacíos claros ("Este evento todavía no tiene ventas").

## Criterios de aceptación

1. Con un evento de más de 200 órdenes, el CSV de órdenes trae **todas**,
   independientemente del filtro/búsqueda en pantalla. Idem entradas > 1000.
2. Neto, bruto, recargo y neto por método del Resumen y del Cierre son
   **idénticos** para el mismo evento.
3. Σ neto del día de Ventas por día = neto del Cierre (incluye un caso con una
   orden pagada un día y reembolsada otro).
4. Una orden pagada a las 23:30 hora de Panamá cae en ese día, no en el siguiente.
5. Para cada método, depósito esperado = bruto − comisión estimada − comisión
   perdida por reembolsos, y residuo de redondeo ≥ 0.
6. Una orden Yappy (y una CuantoApp) reembolsada el mismo día de Panamá en que
   se pagó tiene comisión perdida 0; reembolsada otro día, pierde su comisión
   estimada, que se descuenta del neto final y del depósito esperado.
7. El Cierre muestra PRELIMINAR antes de `event_end` o con pendientes vigentes;
   sin marca en otro caso.
8. Cortesías y regalos aparecen en cantidades y nunca suman a bruto/neto.
9. Una entrada revocada de una orden pagada aparece en "anuladas sin
   reembolso" y su dinero sigue en el neto.
10. Un `buyer_name` `=1+1` aparece literal (`'=1+1`) al abrir el CSV en Excel.
11. El CSV abre con acentos correctos en Excel (Windows y Mac).
12. Con contraseña de soporte o de staff, todas las rutas `reports/*` → 401.
13. El imprimible se ve completo en una hoja carta y el botón imprime (CSP).
14. Comparativo lista todos los eventos no `draft` sin elegir evento.
15. `npm run typecheck` pasa.

## Verificación

- Seed local con un evento de prueba: ~250 órdenes mezclando métodos, una
  reembolsada en otro día, una revocada sin reembolso, una pendiente vigente,
  cortesías y regalos, y entradas usadas desde dos estaciones.
- Cuadrar a mano contra SQL directo (`select sum(net_cents) … where status='paid'`).
- Probar el CSV en Excel y Google Sheets; imprimir a PDF desde Chrome y Safari.
- `npm run preview:cloudflare` para probar endpoints + panel juntos.

## Preguntas abiertas

1. ¿Los nombres de estación de `/validar` son confiables o conviene normalizarlos
   (lista fija) antes de reportar por estación? No bloquea: v1 reporta el texto
   tal cual.

### Resueltas

- **Comisión en reembolsos** → D11 (regla del mismo día para ambos; CuantoApp
  pendiente de confirmar con el procesador).
- **Participación del venue** → no se modela; ningún evento la ha tenido.
- **Efectivo por cobrador** → D12 (lista con nota libre, sin agrupar).
- **Snapshot del cierre** → D13 (no en v1).

## Fuera de alcance

- Excel `.xlsx` multi-hoja, PDF generado en el servidor.
- Ventas por fuente/campaña (lo cubre GA4, `analytics-entradas.md`) y métricas de
  campañas de correo (ya están en el tab Campañas).
- Rol de solo lectura para la banda/venue.
- Participación del venue (porcentaje o fijo) en el cierre.
- Campo estructurado de cobrador para el efectivo.
- Snapshot/congelado del cierre.
- Envío programado de reportes por correo.
- Escaneos rechazados en la puerta (no se registran hoy).
