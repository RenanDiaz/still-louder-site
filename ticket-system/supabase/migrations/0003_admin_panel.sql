-- =============================================================================
-- WWWY3 — Robustecimiento del panel de admin: cortesías
-- =============================================================================
-- Añade el tier 'cortesia' (entradas de regalo, total $0) y el método de pago
-- 'courtesy'. Las cortesías NO cuentan contra el cupo de preventa: tanto
-- presale_status() como create_order() filtran por tier = 'preventa', así que
-- no hay que tocarlas. La revocación de entradas no necesita schema nuevo:
-- reutiliza tickets.status = 'void' (ya rechazado por validate_ticket) con
-- UPDATEs condicionales atómicos desde el backend.
-- =============================================================================

-- Los CHECK inline de 0001 reciben nombres autogenerados (<tabla>_<col>_check).
alter table orders drop constraint if exists orders_tier_check;
alter table orders add constraint orders_tier_check
  check (tier in ('preventa', 'general', 'cortesia'));

alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check
  check (payment_method in ('yappy', 'cuantoapp', 'cash', 'courtesy'));

alter table tickets drop constraint if exists tickets_tier_check;
alter table tickets add constraint tickets_tier_check
  check (tier in ('preventa', 'general', 'cortesia'));

-- Índice para el seguimiento de uso en puerta (check-in en vivo ordena por
-- used_at descendente).
create index if not exists tickets_used_at_idx on tickets (used_at desc)
  where used_at is not null;
