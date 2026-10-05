# Campañas de promoción por correo

> **Estado (5 oct 2026):** spec, sin implementar.
> Subsistema: `ticket-system/` (los contactos salen de `orders`, el envío reusa
> Resend y la gestión vive en `/admin`). No toca el sitio principal.

## Problema

Tenemos el correo de todos los que nos han comprado entradas (o recibido una
cortesía/regalo) en eventos pasados y no lo usamos para nada más que mandar el
QR. Queremos poder escribirles para promocionar **música nueva** (p. ej. "A Las
10") y **eventos nuevos** (p. ej. Halloween Party), siendo **lo menos invasivos
posible**.

Arrancamos con una **muestra reducida** (sobre todo amigos y allegados) para
medir la reacción antes de escribirle a toda la base. Por eso el envío debe
permitir elegir: **a todos**, **escalonado** (en olas) o **a seleccionados**.

**No es un newsletter ni una herramienta de email marketing genérica.** Son
pocos envíos al año, escritos a mano, a una base pequeña.

## Decisiones tomadas

| # | Decisión | Valor |
|---|---|---|
| D1 | Dónde vive | En `ticket-system/` (datos en Supabase, envío por Resend, UI como tab **Campañas** de `/admin`). Solo `isAdmin`; `/support` y staff no ven nada. |
| D2 | Motor de envío | **Propio sobre Resend** (`resend.batch.send`), **no** Resend Broadcasts/Audiences. Motivo: la selección (olas, allegados, tope de frecuencia, exclusiones por evento) depende de nuestros datos; sincronizar contactos a Audiences duplica PII y crea dos fuentes de verdad de las bajas. Costo: la baja y la supresión son nuestras (ver D6). |
| D3 | Origen de los contactos | Correos únicos (`lower(email)`) de órdenes `paid` de **cualquier** evento, **incluidas cortesías** (`courtesy`) y regalos (`gift`) — las cortesías suelen ser allegados, justo la muestra inicial. Se excluyen órdenes solo `pending`/`cancelled` y las 100% reembolsadas. |
| D4 | Base legal | Ley 81 de 2019 (Panamá, datos personales). Los compradores previos no dieron consentimiento explícito para promociones → se tratan como **relación previa de cliente** (`consent_source = 'legacy_buyer'`), con baja en un clic en todo correo y aviso claro de por qué lo reciben. Desde ahora se pide **opt-in explícito** en la compra (Fase 0). ⚠️ Ver P1. |
| D5 | Audiencia vs. entrega | Son ejes separados. **Audiencia**: todos los elegibles / por etiqueta / por evento / selección manual. **Entrega**: inmediata u **olas**. Las tres opciones de la UI ("todos", "escalonado", "seleccionados") son atajos sobre esos dos ejes. |
| D6 | Baja (unsubscribe) | Obligatoria en todo correo de campaña: enlace visible + headers `List-Unsubscribe` / `List-Unsubscribe-Post` (one-click, RFC 8058). La baja es global para promociones y **nunca** afecta los correos transaccionales (QR, comprobantes). |
| D7 | "Poco invasivo" | Sin pixel de apertura ni tracking de clics de Resend. Tope de frecuencia: un contacto no recibe más de **1 campaña cada 14 días** (configurable). Medición solo con UTM hacia el sitio (GA4 ya existe). |
| D8 | Dominio de envío | Subdominio propio para correo **no transaccional**: `Still Louder <hola@noticias.still-louder.com>`, separado de `entradas@still-louder.com` (QRs), para que una queja de spam no afecte la entrega de entradas. El subdominio es solo DNS de correo (SPF/DKIM/DMARC en Resend), no sirve páginas. Requisito antes del primer envío: verificar `noticias.still-louder.com` en Resend (SPF/DKIM) y publicar DMARC. Ver "Relación con Comunicados". |
| D9 | Contenido | Asunto + preheader + cuerpo en **Markdown** (render server-side) sobre una plantilla fija con la paleta `mono` de `api/_lib/email.ts`. Sin HTML libre. Una imagen opcional (URL https). |
| D10 | Olas | **Manuales**: el admin pulsa "Enviar siguiente ola". Sin cron: es a propósito, queremos revisar la reacción entre olas antes de seguir (Cloudflare permitiría programarlas; ver Fase 2). |
| D11 | Teléfonos / WhatsApp | Fuera de alcance. Solo correo. |

## Alcance

### Fase 0 — Opt-in en la compra (urgente, PR aparte)

Mientras siga abierta la venta de Halloween Party, cada compra sin la casilla es
un contacto más sin consentimiento explícito. Debe salir **antes** que el resto.

- Casilla en el formulario de `/entradas` (y en `/regalo`): *"Quiero recibir
  noticias de Still Louder (música y shows). Puedo darme de baja cuando quiera."*
  **Desmarcada por defecto**, no obligatoria para comprar.
- Se guarda en la orden (`orders.marketing_opt_in boolean not null default
  false`, `marketing_opt_in_at timestamptz`). Hay que propagarlo por
  `create_order`, el flujo Yappy (`api/yappy/create-order.ts`) y `claim_gift`.
- Sin envío todavía: solo capturar.

### Fase 1 — Campañas

1. Tabla de contactos derivada de órdenes, con etiquetas y estado de suscripción.
2. CRUD de campañas en borrador + vista previa + **envío de prueba** a una
   dirección (obligatorio antes del primer envío real).
3. Selección de audiencia y modo de entrega (todos / escalonado / seleccionados).
4. Envío por lotes idempotente.
5. Página y endpoint de baja.
6. Métricas por campaña y por ola: enviados, fallidos, omitidos (y por qué),
   bajas atribuidas.

### Fase 2 (después de la muestra)

- Webhook de Resend (`email.bounced`, `email.complained`) → marca el contacto
  `bounced`/`complained`. En Fase 1 basta con la supresión automática de Resend
  y revisar su dashboard (la muestra es pequeña).
- Programar una ola a una hora (si en Fase 1 hace falta).

## Modelo de datos (`supabase/migrations/0015_marketing_campaigns.sql`)

Todas las tablas con RLS habilitado y **sin policies** (solo service-role).

```
marketing_contact
  email            text pk            -- siempre lower(trim(email))
  name             text               -- último buyer_name visto
  consent_source   text  (legacy_buyer | checkout_opt_in)
  status           text  (subscribed | unsubscribed | bounced | complained)
                         default 'subscribed'
  tags             text[] default '{}'   -- p. ej. {'allegado'}; libre, en minúsculas
  first_order_at   timestamptz
  last_order_at    timestamptz
  last_campaign_at timestamptz        -- para el tope de frecuencia
  unsubscribed_at  timestamptz
  created_at       timestamptz default now()

marketing_campaign
  id               uuid pk
  slug             text unique        -- [a-z0-9-]+, se usa en utm_campaign
  subject          text   (1..120)
  preheader        text   (0..140)
  body_md          text
  image_url        text null
  cta_label        text null
  cta_url          text null          -- https; se le agregan UTM al render
  audience         jsonb              -- {kind:'all'|'tags'|'events'|'manual', tags?, event_ids?, exclude_event_ids?}
  delivery         text  (immediate | waves)
  wave_size        int null  (> 0 si waves)
  status           text  (draft | ready | sending | paused | completed | cancelled)
  test_sent_at     timestamptz null   -- gate: no se puede congelar sin prueba
  frozen_at        timestamptz null
  created_at, updated_at

marketing_recipient                   -- snapshot de la audiencia al congelar
  campaign_id      fk -> marketing_campaign (on delete cascade)
  email            fk -> marketing_contact
  position         int                -- orden de envío
  wave             int null           -- se asigna al enviar
  status           text  (queued | sending | sent | failed | skipped)
  skip_reason      text null  (unsubscribed | bounced | complained | frequency_cap)
  resend_id        text null
  error            text null
  sent_at          timestamptz null
  primary key (campaign_id, email)
```

### Poblado de contactos

RPC `sync_marketing_contacts()` (idempotente, la llama el admin al abrir el
tab y antes de congelar): `INSERT … ON CONFLICT (email) DO UPDATE` con nombre y
fechas de `orders` según D3. **Nunca** reescribe `status` ni `tags`; solo sube
`consent_source` de `legacy_buyer` a `checkout_opt_in` si aparece una orden con
`marketing_opt_in`. Una baja no se revierte por comprar de nuevo; solo volviendo
a marcar la casilla de Fase 0 (registrado con fecha).

### Congelar la audiencia

`freeze_campaign(p_campaign_id)`: exige `status = 'draft'` y `test_sent_at` no
nulo; inserta en `marketing_recipient` los contactos `subscribed` que cumplen
`audience`, con `position` así:

- **Escalonado**: primero los que tienen la etiqueta `allegado` (la muestra),
  luego el resto en orden aleatorio (`order by random()`, fijado al congelar).
- **Todos / seleccionados**: orden alfabético (irrelevante, una sola ola).

Pasa la campaña a `ready`. Después de congelar, contenido y audiencia son de
solo lectura (corregir = cancelar y duplicar).

### Enviar una ola

`claim_wave(p_campaign_id, p_size)` (atómico, mismo patrón que `create_order`):
`FOR UPDATE` sobre la campaña; toma los siguientes `p_size` `queued` por
`position`, y en la misma transacción:

- marca `skipped` a los que entretanto quedaron `unsubscribed`/`bounced`/
  `complained`, o tienen `last_campaign_at` dentro del tope de frecuencia;
- marca `sending` y asigna `wave = max(wave)+1` al resto, y los devuelve.

Así, dos clics simultáneos en "Enviar siguiente ola" no envían dos veces al
mismo contacto.

## Endpoints

### Admin — dentro de `api/admin.ts` (gated por `isAdmin`)

| Método y ruta | Qué hace |
|---|---|
| `GET /api/admin/marketing/contacts?tag=&status=&q=` | Sincroniza y lista contactos + conteos por estado. |
| `PATCH /api/admin/marketing/contacts` `{ emails[], add_tags?, remove_tags? }` | Etiquetado masivo (así se marca a los allegados). |
| `GET/POST /api/admin/marketing/campaigns` | Lista / crea borrador. |
| `GET/PATCH/DELETE /api/admin/marketing/campaigns/:id` | Detalle con métricas / edita borrador / borra borrador. |
| `POST …/campaigns/:id/preview` `{ audience }` | Devuelve HTML renderizado + cuántos recibirían y cuántos se omitirían (por razón). |
| `POST …/campaigns/:id/test` `{ email }` | Envío de prueba (asunto con `[PRUEBA]`); fija `test_sent_at`. No toca `marketing_recipient`. |
| `POST …/campaigns/:id/freeze` | `freeze_campaign`. |
| `POST …/campaigns/:id/send` `{ size? }` | `claim_wave` + envío. `immediate` = todo en olas internas de 100 hasta agotar o acercarse al timeout; si queda pendiente devuelve `{ remaining }` y la UI vuelve a llamar. |
| `POST …/campaigns/:id/pause` / `cancel` | Pausa (no toma más olas) / cancela (los `queued` pasan a `skipped`). |

Envío: `resend.batch.send` en grupos de ≤ 100, con header `Idempotency-Key =
<campaign_id>:<wave>:<chunk>`. Al volver: `sent` + `resend_id` +
`last_campaign_at = now()`, o `failed` + `error`. Un `sending` huérfano (timeout
del function) se puede reintentar con un botón que lo devuelve a `queued` solo
si tiene más de 10 min y no tiene `resend_id`.

### Público — `api/marketing.ts` (handler nuevo, sin auth)

- `POST /api/marketing/unsubscribe` — acepta `{ t }` en JSON (desde la página)
  **y** el form-urlencoded `List-Unsubscribe=One-Click` (desde Gmail/Apple Mail,
  con `t` en la query). Valida el token, marca `unsubscribed` (idempotente),
  responde 200. Token inválido → 400 neutro.
- `GET /api/marketing/unsubscribe?t=…` → `{ email_masked, status }` para que la
  página muestre "r***@gmail.com".

> Registrar `/api/marketing/unsubscribe` en el router de `cloudflare/worker.ts`
> (no hay ruteo por filesystem). `CAMPAIGN_EMAIL_FROM` va en `vars` de
> `wrangler.jsonc` (no es secreto).

**Token de baja**: `base64url(email) + '.' + HMAC-SHA256(secret, 'unsub:' +
email)` truncado, con comparación timing-safe (`api/_lib/hmac.ts`). Se deriva de
`TICKET_HMAC_SECRET` con el prefijo `unsub:` como separación de dominio, así no
hay un secreto nuevo que propagar en `release-cloudflare.mjs`. No expira (una
baja debe funcionar siempre).

## Superficie pública — `/baja`

- `baja.html` (entry Vite), `noindex,nofollow` (meta + `X-Robots-Tag` en
  `public/_headers`), tema
  público `src/entradas/theme.css`, como `/ayuda`.
- **La baja no ocurre en el GET de la página**: los escáneres de enlaces de los
  clientes de correo abren los links y darían de baja a gente sin querer. La
  página muestra el correo enmascarado y un botón "Darme de baja" que hace el
  POST. El one-click de `List-Unsubscribe-Post` sí da de baja directo (es POST).
- Estados: confirmar → listo ("No te escribiremos más promociones. Tus entradas
  y comprobantes siguen llegando normal.") / ya estabas de baja / enlace inválido.

## Correo

Plantilla nueva en `api/_lib/marketing-email.ts` (no tocar `sendTicketEmail`):

- From `CAMPAIGN_EMAIL_FROM` (nueva env, opcional con default del subdominio de
  D8), Reply-To `EMAIL_REPLY_TO`: **responder llega a una persona**.
- Encabezado con logo, imagen opcional, cuerpo Markdown, botón CTA, y pie fijo:
  *"Te escribimos porque compraste entradas para un show de Still Louder. Si no
  quieres recibir más noticias, [date de baja aquí]."* (el texto varía según
  `consent_source`).
- Versión texto plano además del HTML.
- UTM en todos los enlaces a `still-louder.com` y `entradas.still-louder.com`:
  `utm_source=email&utm_medium=campaign&utm_campaign=<slug>`.
- Saludo con el primer nombre si existe (`Hola, Ana`); sin otros datos
  personales en el cuerpo.

## Panel admin — tab **Campañas**

No depende del evento seleccionado (como **Eventos**).

1. **Contactos**: tabla con buscador, filtro por estado/etiqueta/evento,
   selección con casillas y "Agregar etiqueta". Aquí se marca a los
   `allegado`.
2. **Campañas**: lista con estado y métricas; "Nueva campaña".
3. **Editor**: asunto, preheader, cuerpo, imagen, CTA; vista previa al lado.
4. **Audiencia y entrega** (radio):
   - *Seleccionados* → por etiqueta(s) y/o elección manual desde Contactos.
   - *Escalonado* → todos los elegibles en olas de N (default 20), allegados
     primero.
   - *Todos* → todos los elegibles de una vez.
   - Opcional en los tres: excluir asistentes de un evento (p. ej. no invitar
     a Halloween a quien ya compró Halloween).
   - Muestra siempre "Recibirán X · Se omiten Y (Z de baja, W por frecuencia)".
5. **Prueba → Congelar → Enviar**: botones en ese orden; "Enviar"/"Enviar
   siguiente ola" pide confirmación con el número exacto de destinatarios.
6. **Freno entre olas**: si la ola anterior tiene ≥ 5 % de bajas + fallidos, el
   botón de la siguiente ola muestra la tasa y exige confirmación explícita.

## Relación con Comunicados

[`comunicados.md`](comunicados.md) son **páginas web** en el dominio raíz
(`still-louder.com/comunicados/<slug>`); no envían correo (su spec lo deja fuera
de alcance). No comparten subdominio porque no hay nada que compartir: el
subdominio de D8 solo existe en el remitente de los correos.

Si en el futuro se quiere **avisar por correo** de un comunicado, hay dos casos:

- **Novedad para fans** (cambio de integrantes, posicionamiento): es una
  campaña más de este sistema — mismo remitente `noticias.`, respeta bajas y
  tope de frecuencia; el CTA enlaza al comunicado. Por eso el subdominio se
  llama `noticias.` y no `promo.`: sirve para ambos.
- **Aviso de servicio a quienes tienen entrada** (show cancelado o movido):
  **no** es una campaña. Va por el canal transaccional (`entradas@`), a los
  compradores de ese evento, **aunque estén de baja** de promociones. Queda
  fuera de este spec (sería una acción "Avisar a compradores" en el tab
  Eventos).

## Criterios de aceptación

- [ ] Una compra con la casilla marcada guarda `marketing_opt_in = true`; sin
      marcar, `false`; la compra no exige la casilla. (Fase 0)
- [ ] Quien recibió una cortesía aparece en Contactos con su evento.
- [ ] La lista de contactos no tiene duplicados por mayúsculas/espacios y no
      incluye compradores con órdenes solo `pending`/`cancelled`.
- [ ] No se puede congelar una campaña sin envío de prueba.
- [ ] Un contacto `unsubscribed` nunca recibe una campaña, aunque se haya dado
      de baja **entre olas** de la misma campaña (queda `skipped/unsubscribed`).
- [ ] Un contacto que recibió una campaña hace < 14 días queda
      `skipped/frequency_cap`.
- [ ] Dos llamadas concurrentes a `send` no envían dos veces al mismo contacto
      (cada `(campaign_id, email)` se envía como mucho una vez).
- [ ] En modo escalonado, la ola 1 sale solo a allegados si hay ≥ N; cada ola
      requiere un clic.
- [ ] Gmail muestra "Cancelar suscripción" junto al remitente (headers de D6) y
      funciona sin abrir la página.
- [ ] Abrir el enlace de baja sin pulsar el botón **no** da de baja.
- [ ] Darse de baja no impide recibir el correo con QR de una compra nueva.
- [ ] El HTML no contiene pixel de seguimiento ni enlaces reescritos por Resend.
- [ ] `npm run typecheck` y `npm run build` pasan; la ruta nueva está en
      `cloudflare/worker.ts`.

## Verificación end-to-end

1. Aplicar `0015_marketing_campaigns.sql`. Con `npm run preview:cloudflare`:
2. Admin → Campañas → Contactos: se sincronizan; etiquetar 3 correos propios
   como `allegado`.
3. Nueva campaña, escalonado, olas de 2 → prueba a tu correo → congelar.
4. Ola 1 → llegan solo 2 allegados; revisar headers (`List-Unsubscribe`), que no
   haya pixel y que los links lleven UTM.
5. Darse de baja con el tercer allegado desde `/baja` → ola 2 → aparece como
   omitido por baja.
6. Doble clic rápido en "Enviar siguiente ola" → ningún duplicado en Resend.
7. Comprar una entrada con ese correo dado de baja → el QR llega igual.

## Preguntas abiertas

- **P1 — Legal (bloqueante para enviar a "todos")**: confirmar que escribir a
  compradores previos sin opt-in es aceptable bajo la Ley 81 con baja en un
  clic. Si no lo es, la alternativa es una única campaña de "¿quieres seguir
  sabiendo de nosotros?" y solo quien acepte queda `subscribed`. La muestra de
  allegados no depende de esto en la práctica, pero conviene decidirlo antes de
  la primera campaña a todos.
- **P2 — ¿Hay que agregar una política de privacidad?** Hoy ni `/entradas` ni
  el sitio principal enlazan una. La casilla de Fase 0 debería enlazar a una.

## Fuera de alcance

- Editor visual / plantillas múltiples / A-B testing.
- Segmentación por comportamiento (aperturas, clics) — no los medimos (D7).
- Altas desde el sitio principal (formulario "suscríbete"). Si se quiere, es
  otro spec y reusaría `marketing_contact` con `consent_source = 'site_form'`.
- WhatsApp / SMS.
