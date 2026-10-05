-- =============================================================================
-- Campañas de promoción — Fase 0: opt-in en la compra
-- (docs/features/campanas-promocion.md)
-- =============================================================================
-- La casilla "Quiero recibir noticias de Still Louder" de /entradas y /regalo
-- (desmarcada por defecto, no obligatoria). Solo se captura; todavía no se
-- envía nada. marketing_opt_in_at es la prueba de cuándo se dio el
-- consentimiento (Ley 81 de 2019).
--
-- Sin cambios a create_order ni claim_gift: api/orders.ts y api/gifts.ts
-- escriben el opt-in con un UPDATE tras el RPC (mismo patrón que 0014). Si ese
-- UPDATE falla, la orden queda en false: el fallo es en la dirección segura
-- (no escribirle a alguien que sí aceptó, nunca al revés). Órdenes viejas,
-- cortesías emitidas desde el admin y pendientes quedan en false.

alter table orders
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists marketing_opt_in_at timestamptz;
