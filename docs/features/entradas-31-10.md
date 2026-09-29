# Venta de entradas — show del 31 de octubre de 2026

> Subsistema: `ticket-system/` (venta) + sitio principal (`public/`, solo el
> enlace de compra). **Depende de `docs/features/multi-evento.md`**: este spec
> describe la configuración y el flujo de UN evento sobre esa fundación. No se
> implementa antes.

## Estado y contexto

| Hecho | Fuente |
|---|---|
| Fecha: **sábado 31 de octubre de 2026, 8:00 p.m.** (hora Panamá) | `NEXT_EVENT.dateISO`, tarjeta `#shows` del sitio |
| Path público ya reservado: `entradas.still-louder.com/31-10` (hoy teaser estático) | `ticket-system/31-10.html` |
| La venta es **directa con la banda**, sin intermediarios | copy de `#shows` y FAQ del sitio |
| Lo único público hoy es la fecha; sin lugar, nombre, cartel ni paleta | comentarios en `31-10.html`, `src/teaser/App.tsx`, `config.js` |
| Hay otro show antes: **11 oct**, teloneros de Stratovarius (Aurora at Soho), venta por **Ticketplus** — **fuera** de este sistema | flyer de la productora |
| Hoy es 27 sep: quedan **34 días** | — |

Todo lo que WWWY3 ya resolvió se hereda sin rediscutir: emisión idempotente
al pasar a `paid`, precios server-side con recargo por método, QR firmado,
cupo race-safe, Yappy V2, Google Wallet, cortesías, regalos, reembolsos,
`/support`, `/ayuda`.

> **Actualización 28 sep:** multi-evento está implementado y la venta abre el
> **1 de octubre** (no el 11, como recomendaba D7). La migración `0011` ya crea
> el evento `31-10` en `teaser` con `presale_start = 2026-10-01T00:00-05:00`;
> D1 y D3–D6 están confirmados y sembrados en la migración, con el evento ya
> en `on_sale` (cuenta regresiva hasta el 1 oct 00:00). Faltan D8–D13 (sobre
> todo el flyer para el OG, D11) y el checklist de operativa.
>
> **Confirmado:** nombre **Still Louder's Halloween Party**, invitados
> **Fábula Sarcástica & Elefreak** (`tagline`), código QR `SL3110`; lugar
> **Hops Food & Drinks, David, Chiriquí** (mismo que WWWY3), aforo **230**
> (mismo que WWWY3), **preventa $10 para las primeras 100** entradas (etapa 1 =
> 100, etapa 2 = 0) y **general $12** para el resto. Las cortesías siguen
> restando del cupo de preventa (política de 0004); los regalos no.
>
> Links de CuantoApp (`CUANTOAPP_PAYMENT_URL_1..10`) con el gross-up de
> 4.9% + $0.35 por transacción — el monto exacto que `/entradas` le muestra al
> comprador:
>
> | Cantidad | Preventa ($10 c/u) | General ($12 c/u) |
> |---|---|---|
> | 1 | $10.89 | $12.99 |
> | 2 | $21.40 | $25.61 |
> | 3 | $31.92 | $38.23 |
> | 4 | $42.43 | $50.85 |
> | 5 | $52.95 | $63.46 |
> | 6 | $63.46 | $76.08 |
> | 7 | $73.98 | $88.70 |
> | 8 | $84.50 | $101.32 |
> | 9 | $95.01 | $113.94 |
> | 10 | $105.53 | $126.56 |

## Decisiones pendientes (llenar antes de implementar)

Cada fila trae una **recomendación** para no bloquear; si se acepta tal cual,
el spec está completo con esos valores.

| # | Decisión | Recomendación / default | Notas |
|---|---|---|---|
| D1 | Nombre del evento y `short_name` | Pendiente. `short_name` ≤ 8 chars, sirve de `code` del QR y sufijo de Wallet | Sin nombre no hay slug definitivo ni copy de correo. |
| D2 | `slug` definitivo | `31-10` como slug canónico; al haber nombre, agregar rewrite `/<nombre>` → `/entradas` **además**, sin retirar `/31-10` | Es el enlace que ya circula (teaser, tarjeta del sitio). |
| D3 | Lugar y dirección | Pendiente | Correo, Wallet, `/ayuda`, JSON-LD del sitio. |
| D4 | Aforo total | Pendiente. Default WWWY3: 230 | `events.total_capacity`. |
| D5 | Tarifas y precios | `preventa` / `general`, mismos nombres que WWWY3. Precios pendientes (WWWY3: $6 / $8) | Si el 31-10 tiene un estreno/aniversario, considerar precio general más alto y preventa corta. |
| D6 | Cupo de preventa Etapa 1 / Etapa 2 | Pendiente. Default WWWY3: 75 / 25 | Etapa 2 la abre el admin cuando quiera. |
| D7 | Ventana de venta | `presale_start`: **la noche del 11 oct** (anunciar en tarima y abrir esa misma noche, 2026-10-11T22:00-05:00) · `presale_end`: 2026-10-31T00:00-05:00 · `sales_end`: 2026-11-01T02:00-05:00 · `event_end`: 2026-11-01T06:00-05:00 | Si se abre antes del 11, el teaser pierde sentido: decidir con marketing. |
| D8 | Métodos de pago | Yappy + Tarjeta (CuantoApp) + Efectivo, como WWWY3 | Requiere links de CuantoApp `CUANTOAPP_PAYMENT_URL_1..10` con los precios nuevos (la comisión es por transacción). |
| D9 | Cortesías y campaña de regalo | Habilitadas (ya existen); N de regalos pendiente | Sin trabajo extra si multi-evento está hecho. |
| D10 | Tema visual | Pendiente. Mientras no haya arte: tema `mono` (negro + hueso, `Anton`/`Archivo`) derivado del teaser actual | Explícitamente NO el morado de WWWY3. |
| D11 | Arte OG (1200×630) y flyer | **Hecho**: flyer oficial (9:16) en la tarjeta de #shows del sitio y `ticket-system/public/og-31-10.jpg` (flyer centrado sobre negro) como og/twitter:image de `/31-10` | Falta cargar `https://entradas.still-louder.com/og-31-10.jpg` en "Imagen OG" del evento (admin → Eventos) para el hero de Wallet. |
| D12 | Hora de puertas | Pendiente | Solo copy. |
| D13 | Entradas de cortesía para banda invitada / prensa | Pendiente | Solo operativa. |

## Alcance funcional

### Ciclo de vida del evento en `/31-10`

Con la fila del evento creada desde la pestaña Eventos del admin
(`slug=31-10`, `code=<D1>`, fechas de D7, tarifas de D5, caps de D4/D6,
`theme=<D10>`):

| `status` / fecha | Qué ve el público en `/31-10` |
|---|---|
| `teaser` (hoy) | Banda + fecha + "Avísame" (misma pantalla mínima del teaser actual). |
| `on_sale`, antes de `presale_start` | Nombre, lugar, fecha, tarifas y **cuenta regresiva** a la apertura; formulario oculto. Servidor rechaza órdenes (`409 sales_closed`). |
| `on_sale`, ventana abierta | Formulario de compra (nombre, email, teléfono, cantidad ≤ 10, método de pago) → orden → instrucciones de pago / botón Yappy → polling hasta `paid`. Contador "quedan N boletos" desde `presale_status.total_available`. |
| `presale_end` pasado | Solo `general`; el selector de tarifa desaparece (la tarifa no es elección del comprador). |
| `EVENT_SOLD_OUT` | Formulario cerrado con aviso de agotado. |
| `sales_end` pasado o `archived` | "El show ya pasó" + enlace a `/ayuda`. |

Nada de esto es lógica nueva: es el flujo de WWWY3 alimentado por el evento.

### Correo, QR y Wallet

- Asunto: `Tu entrada para <short_name> — Still Louder`. Cuerpo con nombre,
  lugar, fecha (`31 de octubre · 8:00 p.m.`), tarifa, un QR por entrada y botón
  de Google Wallet si está configurado.
- QR: `<CODE>.<ticket_id>.<sig>`. **No se rota `TICKET_HMAC_SECRET`** (la firma
  ya está atada al evento).
- Wallet: correr "Clase de Google Wallet" para el evento nuevo desde el admin
  una vez creado.

### `/ayuda`

Copy del evento actual (fecha, lugar, cómo llega el QR, qué hacer si no llega,
reembolsos) + párrafo para compras de shows anteriores. Ya no menciona
"1 de agosto en Hops" salvo en ese párrafo.

### Puerta (`/validar`)

Staff selecciona el evento del 31-10 al entrar. QR de WWWY3 → `wrong_event`.
Estaciones sugeridas: `puerta-1`, `puerta-2` (como WWWY3).

### Sitio principal (`public/`) al abrir la venta

1. `config.js`: `shows.upcoming[31-10].ticketsUrl = 'https://entradas.still-louder.com/31-10'`.
2. Tarjeta del 31-10 en `#shows`: revelar nombre, lugar y hora; CTA "Comprar
   entradas" apuntando a `ticketsUrl` (reemplaza "Enterarme primero").
3. FAQ "¿Cómo compro entradas?": dejar de decir "la venta todavía no abre".
4. JSON-LD `MusicEvent` con `offers.url` = `ticketsUrl`.
5. `sitemap.xml`: `lastmod`.

(La tarjeta del 11-10 no cambia: su venta es de Ticketplus.)

## Operativa previa a la apertura (checklist)

- [ ] Llenar D1–D13.
- [ ] `multi-evento.md` implementado y desplegado con la migración aplicada en
      producción (verificar criterios 1 y 2 de ese spec **antes** de crear el
      evento).
- [ ] Crear el evento en el admin (`draft`) con tarifas, caps y fechas; revisar
      en `/31-10` con `status=teaser` que nada cambió para el público.
- [ ] `CUANTOAPP_PAYMENT_URL_1..10` con los precios nuevos (productos ocultos en
      CuantoApp). Comprobar el gross-up con una compra de prueba de 1 y de 2.
- [ ] Yappy: confirmar que las credenciales del Botón de Pago siguen vigentes
      (`YAPPY_BTN_ENV=prod`); una compra real de $1 y su reversa el mismo día.
- [ ] Wallet: clase creada para el evento.
- [ ] Resend: el plan gratis limita a **100 correos/día**. Con la apertura la
      noche del 11 oct, estimar órdenes/día; si se esperan > 80 el primer día,
      subir de plan **antes** o aceptar que el correo se reintente al día
      siguiente vía "Reenviar" desde `/support`.
- [ ] Arte OG cargado (`og_image_url`) o decisión explícita de ir sin imagen.
- [ ] Cambiar `status` a `on_sale` con `presale_start` en la fecha de D7. El
      formulario se abre solo, sin redeploy.
- [ ] Publicar en el sitio principal (sección anterior) el mismo día.

## Criterios de aceptación

1. `/31-10` en `teaser` es indistinguible del teaser actual (misma info
   pública, ninguna llamada extra de red visible salvo `presale/status`).
2. Al pasar a `on_sale` con `presale_start` futuro, `/31-10` muestra la cuenta
   regresiva y `POST /api/orders { event: '31-10' }` devuelve `409 sales_closed`.
3. En ventana: una orden `preventa` × 2 por Yappy descuenta 2 del cupo de
   preventa del 31-10 y 0 del de WWWY3; el total cobrado = gross-up de
   `2 × precio_preventa` con la comisión de Yappy.
4. La IPN de Yappy con `status='E'` emite 2 tickets con prefijo `<CODE>`, envía
   un correo con 2 QR y el botón de Wallet; una segunda IPN idéntica no duplica
   nada.
5. Ambos QR pasan en `/validar` (evento 31-10) exactamente una vez; en la
   estación con WWWY3 seleccionado → `wrong_event`.
6. Tras `presale_end`, el formulario solo ofrece `general` y el servidor rechaza
   `tier=preventa` con `presale_closed`.
7. Al agotar `total_capacity`, `/31-10` muestra agotado y el servidor devuelve
   `409 sold_out`.
8. Después de `sales_end`, `/31-10` muestra "ya pasó" y `/ayuda` sigue
   resolviendo consultas del 31-10 (buscar por email en `/support` funciona).
9. El sitio principal enlaza a `/31-10` desde la tarjeta y la FAQ; el evento
   `click_shows` se registra con `event_label: 'tickets'`.

## Riesgos

- **Tiempo.** 34 días para: multi-evento (la parte grande) + configurar +
  probar pagos reales. Si multi-evento no está listo para el ~8 oct, el plan B
  es la ruta manual del README ("Para el próximo evento": editar constantes y
  rotar el HMAC), que mezcla datos pero vende. Decidir el 5 oct a más tardar.
- **Resend 100/día** el día del anuncio (arriba).
- **Ventana de reserva de 48 h** para efectivo/tarjeta con solo ~20 días de
  venta: revisar cupo pendiente a diario desde el admin y cancelar vencidas.
- **Etapa 2 y aforo** dependen del lugar (D3/D4): sin lugar no hay números.
