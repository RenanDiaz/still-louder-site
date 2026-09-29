-- =============================================================================
-- 31-10 — Tema e imagen OG a partir del flyer oficial
-- =============================================================================
-- Llegó el flyer de Still Louder's Halloween Party: el evento deja el tema
-- `mono` (placeholder sin arte) y pasa al tema `halloween`
-- (src/entradas/themes/halloween.css: noche + rojo sangre + hueso, con el
-- titular del flyer como hero), y su imagen OG/Wallet pasa a ser el flyer
-- (public/og-31-10.jpg). Solo datos; ambos campos también se editan desde la
-- pestaña Eventos del admin. Idempotente: solo toca la fila si sigue con los
-- valores sembrados por 0011, así no pisa un cambio hecho a mano en el admin.

update events
set theme = 'halloween'
where slug = '31-10' and theme = 'mono';

update events
set og_image_url = 'https://entradas.still-louder.com/og-31-10.jpg'
where slug = '31-10' and og_image_url is null;
