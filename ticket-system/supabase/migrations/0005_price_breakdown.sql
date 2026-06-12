-- =============================================================================
-- WWWY3 — Desglose de precio: neto recibido vs. cargo por servicio
-- =============================================================================
-- A partir de ahora el comprador paga un precio "grossed-up" que absorbe la
-- comisión del método de pago, de modo que el NETO que recibe la banda iguala
-- al precio base ($6 preventa / $8 general). Guardamos el desglose para
-- reportería interna:
--
--   total_cents = lo que paga el comprador (incluye el recargo)
--   net_cents   = lo que recibe la banda (precio base x cantidad)
--   fee_cents   = recargo por servicio = total_cents - net_cents
--
-- La comisión es POR TRANSACCIÓN (el fijo de CuantoApp $0.35 se aplica una sola
-- vez sobre la orden completa, no por entrada), así que el cálculo lo hace el
-- servidor en api/_lib/pricing.ts y pasa los tres valores ya resueltos.
-- =============================================================================

alter table orders
  add column if not exists net_cents int not null default 0,
  add column if not exists fee_cents int not null default 0;

-- Backfill de órdenes existentes: antes de este cambio el total no llevaba
-- recargo, así que el neto era el total y la comisión efectiva queda en 0
-- (la comisión real la absorbía la banda; no la reconstruimos retroactivamente).
update orders
set net_cents = total_cents,
    fee_cents = 0
where net_cents = 0 and fee_cents = 0;

-- --- create_order: ahora recibe el desglose ----------------------------------
-- La firma cambia (se añaden p_net_cents / p_fee_cents), así que hay que dropear
-- la versión anterior (0004) antes de recrear: cambiar la lista de argumentos
-- crea una sobrecarga ambigua en lugar de reemplazar.
drop function if exists create_order(text, text, text, text, int, int, text, int);

create or replace function create_order(
  p_buyer_name         text,
  p_buyer_email        text,
  p_buyer_phone        text,
  p_tier               text,
  p_quantity           int,
  p_total_cents        int,
  p_net_cents          int,
  p_fee_cents          int,
  p_payment_method     text,
  p_reservation_minutes int
)
returns orders
language plpgsql
as $$
declare
  v_cfg       event_config;
  v_capacity  int;
  v_committed int;
  v_order     orders;
begin
  if p_tier = 'preventa' then
    -- Serialize presale capacity decisions on the single config row.
    select * into v_cfg from event_config where id = 1 for update;

    v_capacity := v_cfg.presale_stage1_cap +
      case when v_cfg.presale_stage2_active then v_cfg.presale_stage2_cap else 0 end;

    select coalesce(sum(quantity), 0) into v_committed
    from orders
    where (tier = 'preventa'
           and (status = 'paid'
                or (status = 'pending' and reservation_expires_at > now())))
       or (tier = 'cortesia' and status = 'paid');

    if v_committed + p_quantity > v_capacity then
      raise exception 'PRESALE_SOLD_OUT'
        using errcode = 'P0001',
              detail  = format('available=%s requested=%s',
                               greatest(v_capacity - v_committed, 0), p_quantity);
    end if;
  end if;

  insert into orders (
    buyer_name, buyer_email, buyer_phone, tier, quantity,
    total_cents, net_cents, fee_cents, payment_method, status, reservation_expires_at
  )
  values (
    p_buyer_name, p_buyer_email, p_buyer_phone, p_tier, p_quantity,
    p_total_cents, p_net_cents, p_fee_cents, p_payment_method, 'pending',
    now() + make_interval(mins => p_reservation_minutes)
  )
  returning * into v_order;

  return v_order;
end;
$$;
