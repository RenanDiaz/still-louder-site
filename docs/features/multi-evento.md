# Ticket-system multi-evento (fundación para el 31-10)

> Subsistema: `ticket-system/`. Este spec **no** vende nada todavía: convierte el
> sistema mono-evento (WWWY3 hardcodeado) en uno que soporta varios eventos con
> datos separados. La venta del 31 de octubre se especifica aparte en
> `docs/features/entradas-31-10.md` y **depende de este**.

## Estado: implementado (28 sep 2026)

Implementado según este spec, con estas desviaciones deliberadas:

| Spec | Implementación | Por qué |
|---|---|---|
| `31-10.html` y `src/teaser/` se eliminan | `src/teaser/` se movió a `src/entradas/Teaser.tsx` (+ `teaser.css`); **`31-10.html` se conserva** pero carga `src/entradas/main.tsx` | El preview del enlace de `/31-10` sigue teniendo sus propias meta (criterio 1 de `entradas-31-10.md`); sin rewrite. |
| Evento "actual" = `on_sale` más cercano, si no el último `archived` | `on_sale` → **`teaser`** → último `archived` | Hoy (31-10 en teaser) `/entradas` y `/ayuda` muestran el próximo show, no WWWY3. |
| Slugs futuros por rewrite | Rewrite **o** `/entradas?evento=<slug>` | Un evento nuevo es visitable sin redeploy. |
| `/validar` elige evento | El listado de eventos de la puerta sale de `GET /api/tickets/validate` (staff) | Cero archivos nuevos bajo `api/`; staff no necesita permisos de admin. |
| Soporte cruza eventos | `GET /api/admin/orders` **sin** `?event=` = búsqueda de soporte (requiere término) para soporte **y** admin | `/support` también se usa con la contraseña de admin. |
| `documentName` de Yappy usa `short_name` | Sin cambio | `documentName` lo devuelve Yappy; no lo mandamos nosotros. |
| — | Una orden a una tarifa con precio 0 → `409 tier_unavailable`; pasar a `on_sale` exige precios > 0 | Evita órdenes de $0 por un evento mal configurado. |
| — | `GOOGLE_WALLET_CLASS_SUFFIX` retirado: clase = `${issuer}.${code.toLowerCase()}` | La de WWWY3 sigue siendo `…wwwy3` (el default anterior). |

La migración siembra el show del 31-10 (`slug=31-10`, `code=SL3110`, `teaser`,
`presale_start` = 1 oct 00:00): Hops Food & Drinks, aforo 230, preventa $10 ×
100, general $12. Nombre y código provisionales.

## Contexto y problema

Hoy el sistema tiene **un solo evento implícito**:

| Acoplamiento a WWWY3 | Dónde vive |
|---|---|
| Cupo de preventa, Etapa 2, aforo total | fila única `event_config` (id = 1) |
| Precios por tarifa | `api/_lib/pricing.ts` (`TIER_PRICE_CENTS`) + espejo en `src/shared/config.ts` |
| Fechas (inicio/fin de preventa, cierre de venta, cierre de puerta) | `pricing.ts`, `event.ts` + espejo en `config.ts` (`EVENT`) |
| Prefijo del QR | `api/_lib/hmac.ts` (`PREFIX = 'WWWY3'`) |
| Nombre, lugar y fecha en el correo, Google Wallet y recibo de reembolso | `email.ts`, `google-wallet.ts`, `receipt.ts` (strings literales) |
| Copy y arte de `/entradas`, `/ayuda`, `/regalo` | `src/entradas/App.tsx`, `src/ayuda/App.tsx`, `src/regalo/App.tsx` |
| Títulos y llaves de `localStorage` de admin/soporte/puerta | `wwwy3_admin_pw`, `Panel WWWY3`, CSVs `*-wwwy3-*` |

Consecuencias si se reusa "editando constantes" (la lista de "Para el próximo
evento" del README):

1. Las órdenes y entradas de WWWY3 quedan **mezcladas** con las nuevas en
   reportes, CSV, check-in y búsquedas de soporte.
2. Hay que **rotar `TICKET_HMAC_SECRET`** para que un QR `valid` sin usar de
   WWWY3 no pase la puerta del show nuevo, lo que invalida también los enlaces
   de QR/Wallet que la gente tiene guardados del show pasado.
3. Cada show futuro repite la misma edición manual en ~10 archivos.

Ya hay **dos shows en el calendario** (11 oct como teloneros — venta externa por
Ticketplus, fuera de este sistema — y 31 oct venta propia) y la intención es
seguir vendiendo directo. **Recomendación: tabla `events` ahora**, con alcance
acotado (abajo). El costo es una migración con backfill y tocar cada superficie
una vez; el beneficio es que el 31-10 y cada show siguiente son **una fila
nueva**, no un fork del código.

## Decisiones

| Decisión | Resolución | Por qué |
|---|---|---|
| Fuente de verdad de un evento | Fila en `events` (fechas, caps, aforo, estado, copy básico). Se **retira `event_config`**. | Un solo lugar; el `FOR UPDATE` sobre la fila del evento conserva la serialización race-safe. |
| Precios por tarifa | Tabla `event_tier` (`event_id`, `tier`, `price_cents`). | Sigue siendo **server-authoritative** (el cliente nunca manda montos); deja de vivir en código duplicado. |
| Espejo cliente/servidor de fechas y precios | **Se elimina.** El cliente lee `GET /api/presale/status?event=<slug>`, que ahora devuelve también los datos públicos del evento. | El espejo existía porque no había endpoint; con eventos en BD sería duplicar por evento. El servidor sigue mandando. |
| Prefijo del QR | `events.code` (p. ej. `WWWY3`, `SL3110`): payload `<CODE>.<ticket_id>.<sig>`. | Un QR declara su evento antes de tocar la BD. |
| Firma HMAC | `sig = HMAC(code + '.' + ticket_id)` con el **mismo** `TICKET_HMAC_SECRET`. | La firma queda atada al evento; **no hace falta rotar el secreto** por show. Los tokens viejos de WWWY3 (firmados solo con `ticket_id`) dejan de verificar: aceptable, su puerta ya está cerrada por `event_end`; el reenvío de correo regenera tokens válidos si alguien los pide. |
| Identificación del evento en URLs públicas | Por **path** (`/31-10`, `/when-we-were-young-3`) vía rewrites a `/entradas`; la app lee el slug de `location.pathname`. `/entradas` a secas = el evento "actual" (ver abajo). | Mismo patrón que `/regalo/<token>`. Un solo entry Vite para la compra. |
| Evento "actual" | El servidor lo resuelve: el evento `on_sale` con `starts_at` más cercano; si no hay, el último `archived`. | El cliente no decide qué se vende. |
| Estados de evento | `draft` → `teaser` → `on_sale` → `archived`. | Reemplaza las fechas-interruptor de `event.ts` como estado explícito; las fechas siguen mandando dentro de `on_sale`. |
| Passwords admin/staff/soporte | Globales, sin cambio. | Es la misma banda operando todos los shows. |
| Tema visual | Por evento: `events.theme` (slug de un CSS en `src/entradas/themes/`). WWWY3 conserva el morado como tema `wwwy3`. | Cumple lo que el teaser dejó escrito: el 31-10 no hereda la identidad de WWWY3. |
| Funciones serverless | **Cero archivos nuevos** bajo `api/` (seguimos en 11/12). Rutas de eventos del admin van dentro de `api/admin.ts`; los datos públicos del evento salen por `presale/status`. | Límite duro de Vercel Hobby. |

## Modelo de datos — `supabase/migrations/0011_events.sql`

```
events
  id                    uuid pk default gen_random_uuid()
  slug                  text unique         -- path público: 'when-we-were-young-3', '31-10'
  code                  text unique         -- prefijo del QR, [A-Z0-9]{3,8}: 'WWWY3'
  name                  text                -- 'When We Were Young 3'
  short_name            text                -- 'WWWY3' (correo, CSV, títulos)
  venue                 text
  venue_address         text
  starts_at             timestamptz         -- inicio del show
  presale_start         timestamptz         -- abre la venta (todas las tarifas)
  presale_end           timestamptz         -- desde aquí solo 'general'
  sales_end             timestamptz         -- no más órdenes ni regalos
  event_end             timestamptz         -- la puerta deja de validar
  presale_stage1_cap    int  not null default 75
  presale_stage2_cap    int  not null default 25
  presale_stage2_active boolean not null default false
  total_capacity        int  not null default 230
  status                text check (status in ('draft','teaser','on_sale','archived'))
  theme                 text not null default 'default'
  og_image_url          text                -- opcional; el teaser del 31-10 lo deja null a propósito
  created_at, updated_at timestamptz

event_tier
  event_id    fk -> events (on delete cascade)
  tier        text check (tier in ('preventa','general'))   -- cortesia/regalo son $0 siempre
  price_cents int  check (price_cents >= 0)
  primary key (event_id, tier)
```

Cambios sobre tablas existentes, en este orden dentro de la misma migración:

1. Insertar la fila de WWWY3 copiando los caps/aforo de `event_config` y las
   fechas/precios que hoy están en código (`2026-06-15` → `2026-08-01` →
   `2026-08-02T02:00` → `2026-08-02T06:00`; preventa 600 / general 800;
   `status = 'archived'`, `theme = 'wwwy3'`, `code = 'WWWY3'`,
   `slug = 'when-we-were-young-3'`).
2. `orders`, `tickets`, `gift_campaign`: `add column event_id uuid references
   events(id)`; backfill al id de WWWY3; luego `set not null`. Índices
   `orders (event_id, status)`, `tickets (event_id, status)`,
   `gift_campaign (event_id)`.
3. Reescribir RPCs con `p_event_id uuid` como primer parámetro:
   `create_order`, `presale_status`, `claim_gift` (el evento viene de la
   campaña, no del parámetro), `cleanup_expired_orders` (sin parámetro: limpia
   todos). `mark_order_paid`, `validate_ticket`, `refund_order`,
   `mark_order_emailed` no cambian de firma (operan por id) pero deben copiar
   `event_id` de la orden al insertar tickets.
4. `create_order` y `presale_status`: el `select ... for update` pasa de
   `event_config where id = 1` a `events where id = p_event_id`. Los conteos
   filtran por `event_id`. Semántica de cupo, Etapa 2, aforo total, cortesías
   y regalos: **idéntica** a 0004/0007/0010, solo scopeada.
5. `drop table event_config` al final (nada más la referencia tras el paso 3).
   RLS habilitado y sin policies en `events`/`event_tier`, como el resto.

Invariante nuevo: **toda orden, entrada y campaña de regalo pertenece a
exactamente un evento**, y una entrada siempre tiene el `event_id` de su orden.

## Backend

### `api/_lib/events.ts` (nuevo módulo, no función serverless)

- `getEventBySlug(slug)`, `getEventById(id)`, `getCurrentEvent()` (regla del
  evento "actual" de arriba), `getTierPrices(eventId)`.
- Las funciones de fecha de `event.ts`/`pricing.ts` pasan a recibir el evento:
  `areSalesOpen(event, now)`, `isPresaleOpen(event, now)`,
  `haveSalesEnded(event, now)`, `isEventOver(event, now)`. `event.ts` y las
  constantes `*_ISO` desaparecen.
- `priceBreakdown(priceCents, quantity, method)` deja de recibir `tier`: el
  precio ya viene resuelto del `event_tier`. Fees por método no cambian.

### `api/_lib/hmac.ts`

- `makeToken(eventCode, ticketId)` → `${code}.${ticketId}.${sig}`.
- `verifyToken(token)` → `{ code, ticketId } | null`. Valida el formato del
  código con la regex antes de firmar. Sigue sin tocar la BD.

### Endpoints públicos

- `GET /api/presale/status?event=<slug>` (sin `event` = evento actual). Devuelve
  `{ event: { slug, code, name, short_name, venue, starts_at, presale_start,
  presale_end, sales_end, event_end, status, theme, tiers: { preventa, general }
  }, presale: <PresaleStatus actual> }`. Nunca expone caps internos más allá de
  lo que hoy expone `PresaleStatus`.
- `POST /api/orders` body += `event` (slug). El servidor resuelve el evento,
  rechaza `404 event_not_found` y `409 sales_closed` si `status <> 'on_sale'`
  o por fecha (igual que hoy). Pasa `p_event_id` al RPC.
- `GET /api/orders/:id/status`: sin cambio de contrato; incluye `event.slug`.
- `POST /api/tickets/validate` body += `event` (slug de la estación). Flujo:
  `verifyToken` → si `code` no corresponde al evento de la estación →
  `200 { result: 'wrong_event' }` **sin tocar la BD** → `isEventOver(event)` →
  RPC. `ValidateResult` += `'wrong_event'`.
- `GET /api/tickets/qr?t=` y `GET /api/wallet/google/:ticketId`: sin cambio de
  contrato; el token se genera con el código del evento de la entrada.
- `GET/POST /api/gifts`: la campaña trae `event_id`; `claim_gift` inserta la
  orden en ese evento; se rechaza si el evento no está `on_sale` o
  `sales_end` pasó.
- Yappy (`config`, `create-order`, `ipn`): sin cambios funcionales; `documentName`
  usa `events.short_name`.

### Admin (`api/admin.ts`, mismo archivo)

- Todas las rutas existentes aceptan `?event=<id>` y filtran por él (órdenes,
  stats, tickets, check-in, cortesías, CSV, regalos, stage2). Sin `event` →
  `400 event_required` (nunca "todos" por accidente en mutaciones; el listado
  de soporte sí puede cruzar eventos, ver abajo).
- Nuevas rutas:
  - `GET  /api/admin/events` → lista con métricas resumidas (pagadas, aforo).
  - `POST /api/admin/events` → crear (validar `slug`, `code`, orden de fechas,
    caps > 0; `status` inicial `draft`).
  - `PATCH /api/admin/events/:id` → editar campos y tarifas. Regla: **no** se
    pueden cambiar `code` ni `slug` si el evento ya tiene tickets emitidos.
  - `POST /api/admin/events/:id/status` `{ status }` → transiciones válidas:
    `draft→teaser→on_sale→archived` y `on_sale→teaser` (pausar). `archived` es
    terminal.
  - `POST /api/admin/wallet/google/ensure-class?event=<id>` → clase de Wallet
    por evento (`classSuffix = code.toLowerCase()`).
- Cron `orders/cleanup`: sin parámetro, limpia todos los eventos.

### Correo, Wallet y recibo

`sendTicketEmail(order, event, tokens)`, `buildWalletSaveUrl` y `receipt.ts`
reciben el evento y sacan nombre, lugar, fecha y `short_name` de él. Sin
literales de WWWY3. El asunto pasa a `Tu entrada para ${short_name} — Still Louder`.
La variante de copy para `gift` se conserva.

## Frontend

### `/entradas` (compra)

- Único entry de compra. Resuelve el slug: `/entradas` → sin `event` (actual);
  cualquier otro path → su último segmento. Rewrites en `vercel.json` y
  `public/_redirects`: `/when-we-were-young-3 → /entradas`, `/31-10 → /entradas`
  (y los slugs futuros). **`31-10.html` y `src/teaser/` se eliminan** al aplicar
  este spec: el teaser pasa a ser el estado `teaser` del evento en la misma app
  (misma pantalla mínima: banda + fecha + "Avísame", sin backend adicional
  porque `presale/status` ya se consulta).
- Estados de pantalla, decididos por `event.status` + fechas del servidor:
  `teaser` → teaser; `on_sale` antes de `presale_start` → countdown; `on_sale`
  en ventana → formulario; `sales_end` pasado o `archived` → "el show ya pasó"
  (la pantalla de archivo que hoy tiene WWWY3, con copy genérico desde el
  evento).
- Tema: `<html data-theme="{event.theme}">`; `theme.css` conserva las variables
  base, `themes/wwwy3.css` y `themes/<nuevo>.css` solo sobreescriben tokens.
  El arte de WWWY3 (`wwwy3-title.webp`) queda dentro de su tema.
- Se eliminan `EVENT`, `NEXT_EVENT` y `TIERS` de `src/shared/config.ts`
  (quedan `SOCIAL`, `TIER_LABELS`, `PAYMENT_METHODS`, fees y helpers).
- `sessionStorage` de la orden pendiente se guarda por slug.

### `/ayuda`, `/regalo`

Copy desde el evento (`/regalo` desde el evento de la campaña; `/ayuda` desde el
evento actual, con una línea sobre "compras de shows anteriores").

### `/admin`

- Selector de evento arriba (persistido en `localStorage`), todas las llamadas
  llevan `event`. Título `Panel · {short_name}`; CSV `ordenes-{slug}-{fecha}.csv`.
- Pestaña **Eventos**: tabla + formulario crear/editar (fechas con hora local
  Panamá, caps, aforo, tarifas, tema, slug/código) + botones de transición de
  estado con confirmación. Es donde nace el 31-10.
- Llaves de `localStorage` sin `wwwy3_` (`sl_admin_pw`, etc.).

### `/support`

La búsqueda cruza todos los eventos (el comprador escribe por cualquier compra);
cada resultado muestra el evento. Reenvío de correo usa el evento de la orden.

### `/validar`

Al iniciar sesión el staff elige el evento (default: el `on_sale`/`teaser` con
`event_end > now` más cercano); `event` viaja en cada validación. `wrong_event`
se muestra en rojo con el nombre del evento del QR, distinto de `forged`.

## Seguridad

- Sin cambios en el modelo de secretos (todo server-only). No se rota
  `TICKET_HMAC_SECRET`.
- `wrong_event` y `forged` se deciden antes de la BD, igual que hoy.
- Las rutas admin de eventos van bajo `isAdmin`; crear/editar eventos no es
  tarea de soporte ni de staff.
- CSP: sin cambios (no hay dominios nuevos).

## Fuera de alcance

- Vender dos eventos **al mismo tiempo** desde `/entradas` a secas (hay un solo
  evento "actual"; cada evento sí tiene su path).
- Passwords por evento, roles por evento, multi-banda.
- Migrar la configuración de Yappy/Resend por evento.
- Apple Wallet.

## Criterios de aceptación

1. Tras `0011_events.sql`, **todas** las órdenes, entradas y campañas
   existentes tienen `event_id` = WWWY3; `select count(*) from orders where
   event_id is null` = 0; `event_config` ya no existe.
2. `/admin` → Resumen con WWWY3 seleccionado muestra exactamente los mismos
   números que antes de la migración (pagadas, ingresos, emitidas/usadas).
3. Crear un evento `draft` desde la pestaña Eventos, pasarlo a `teaser`: su
   path muestra el teaser; `POST /api/orders` con su slug → `409 sales_closed`.
4. Pasarlo a `on_sale` con `presale_start` en el pasado: `/<slug>` muestra el
   formulario con las tarifas de `event_tier`; una orden se crea con su
   `event_id`; el cupo de WWWY3 no cambia y viceversa.
5. Marcar pagada una orden del evento nuevo emite tickets con
   `<CODE>.<id>.<sig>`; `/validar` con ese evento seleccionado → `valid` una
   sola vez; con WWWY3 seleccionado → `wrong_event` sin registro en BD; un QR
   de WWWY3 en la estación del evento nuevo → `wrong_event`.
6. Un token manipulado (código válido, firma inválida) → `forged` sin tocar la
   BD.
7. `/support` encuentra por email una orden de WWWY3 y una del evento nuevo en
   la misma búsqueda, cada una con su evento; reenviar correo de cada una manda
   el copy de su evento.
8. Cortesía y campaña de regalo se crean **contra un evento** y sus entradas
   llevan ese `event_id`; el regalo sigue sin restar cupo de preventa.
9. `cd ticket-system && npm run typecheck && npm run build` en verde;
   `cloudflare/worker.ts` sigue enrutando todo (no hay archivos nuevos en
   `api/`, así que no requiere registro).
10. Conteo de funciones serverless: sigue en **11**.

## Verificación end-to-end sugerida

Con `vercel dev` y la migración aplicada a un proyecto Supabase de prueba
(clonar el de producción antes de tocar el real):

1. Migrar → correr 1 y 2 de los criterios.
2. Crear evento de prueba `slug=test-show`, `code=TEST1`, tarifas 100/200,
   caps 2/1, aforo 5 → recorrer 3, 4, 5, 6 con dos estaciones de `/validar`
   abiertas en eventos distintos.
3. Reembolsar una orden del evento nuevo → recibo con su nombre; stats de WWWY3
   intactas.
4. Archivar el evento de prueba → su path muestra "ya pasó"; `/entradas` a
   secas vuelve a resolver a WWWY3 (último archivado) hasta que exista otro
   `on_sale`.

## Orden de implementación (para el agente)

1. Migración `0011` + `api/_lib/events.ts` + RPCs; typecheck.
2. `hmac.ts`, `validate.ts`, `qr.ts`, `wallet` (tokens con código).
3. `orders.ts`, `presale/status.ts`, `gifts.ts`, `issue.ts`, `email.ts`,
   `receipt.ts`, `google-wallet.ts` (evento como parámetro).
4. `admin.ts` (scope + rutas de eventos) y pestaña Eventos.
5. `/entradas` genérico + temas + rewrites; borrar teaser.
6. `/validar`, `/support`, `/ayuda`, `/regalo`.
7. README del ticket-system: sección "Estado post-evento" y "Para el próximo
   evento" se reemplazan por "Crear un evento nuevo" (pestaña Eventos).
