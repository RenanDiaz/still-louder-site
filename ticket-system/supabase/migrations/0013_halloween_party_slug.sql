-- =============================================================================
-- 31-10 — El slug público pasa de `31-10` a `halloween-party`
-- =============================================================================
-- La URL del show pasa a ser entradas.still-louder.com/halloween-party (más
-- legible y con el nombre del evento). `/31-10` ya circula (teaser, tarjeta del
-- sitio, flyers), así que queda como redirect 301 (vercel.json +
-- public/_redirects); ningún enlace se rompe.
--
-- Solo cambia `slug`: el `code` (SL3110) es lo que va firmado en los QR, así
-- que las entradas ya emitidas siguen validando. El slug no se guarda en
-- correos, QR ni Wallet (solo lo usa la app para resolver el evento), por eso
-- se cambia aquí aunque el admin lo bloquee cuando ya hay entradas
-- (`identity_locked`). Idempotente: solo toca la fila si sigue con el slug viejo.

update events
set slug = 'halloween-party'
where slug = '31-10'
  and not exists (select 1 from events where slug = 'halloween-party');
