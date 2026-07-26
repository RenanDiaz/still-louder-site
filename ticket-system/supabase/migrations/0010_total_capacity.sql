-- =============================================================================
-- WWWY3 — Aforo total del evento (tope duro de venta: 225 boletos)
-- =============================================================================
-- Hasta ahora solo la preventa tenía cupo; la tarifa general vendía sin tope
-- ("capped by venue, not here"). Con ~200 vendidos y un máximo de 225 a vender,
-- el aforo pasa a ser un límite del sistema:
--
--   * event_config.total_capacity (default 225) es el máximo de boletos
--     comprometidos entre TODAS las tarifas (preventa, general, cortesía y
--     regalo): órdenes pagadas + pendientes con reserva vigente. Las órdenes
--     canceladas/reembolsadas liberan su cupo.
--   * create_order() valida ese tope para CUALQUIER tarifa, serializado con el
--     mismo `for update` sobre la fila única de event_config que ya usaba la
--     preventa (ahora se toma siempre, no solo para 'preventa'). Al excederse
--     lanza EVENT_SOLD_OUT y el endpoint responde 409 `sold_out`.
--   * presale_status() devuelve además total_capacity / total_committed /
--     total_available / event_sold_out para el contador público de /entradas.
--     El `available` de preventa queda acotado por total_available (no tiene
--     sentido anunciar más preventa que asientos restantes).
--
-- Las emisiones del admin (cortesías) y los regalos NO pasan por create_order,
-- así que no quedan bloqueados por el tope — pero sí lo consumen al contarse
-- como órdenes pagadas. El tipo de retorno de presale_status() cambia, así que
-- hay que dropear y recrear (CREATE OR REPLACE no permite cambiar columnas de
-- salida); create_order() conserva su firma y basta CREATE OR REPLACE.
-- =============================================================================

alter table event_config
  add column if not exists total_capacity int not null default 225;

update event_config set total_capacity = 225 where id = 1;

-- --- presale_status: ahora también reporta el aforo total ---------------------

drop function if exists presale_status();

create function presale_status()
returns table (
  capacity        int,
  paid_count      int,
  pending_count   int,
  courtesy_count  int,
  committed       int,
  available       int,
  stage2_active   boolean,
  stage2_cap      int,
  sold_out        boolean,
  total_capacity  int,
  total_committed int,
  total_available int,
  event_sold_out  boolean
)
language plpgsql
stable
as $$
declare
  v_cfg event_config;
begin
  select * into v_cfg from event_config where id = 1;

  capacity := v_cfg.presale_stage1_cap +
    case when v_cfg.presale_stage2_active then v_cfg.presale_stage2_cap else 0 end;

  select coalesce(sum(quantity), 0) into paid_count
  from orders where tier = 'preventa' and status = 'paid';

  select coalesce(sum(quantity), 0) into pending_count
  from orders
  where tier = 'preventa'
    and status = 'pending'
    and reservation_expires_at > now();

  -- Las cortesías se emiten pagadas al instante (nunca quedan pendientes con
  -- reserva), así que basta con contar las pagadas.
  select coalesce(sum(quantity), 0) into courtesy_count
  from orders where tier = 'cortesia' and status = 'paid';

  -- Aforo total: TODAS las tarifas comprometen asientos (pagadas + pendientes
  -- con reserva vigente). Canceladas y reembolsadas quedan fuera.
  select coalesce(sum(quantity), 0) into total_committed
  from orders
  where status = 'paid'
     or (status = 'pending' and reservation_expires_at > now());

  total_capacity  := v_cfg.total_capacity;
  total_available := greatest(v_cfg.total_capacity - total_committed, 0);
  event_sold_out  := total_committed >= v_cfg.total_capacity;

  committed     := paid_count + pending_count + courtesy_count;
  -- La preventa nunca puede ofrecer más asientos de los que quedan en total.
  available     := least(greatest(capacity - committed, 0), total_available);
  stage2_active := v_cfg.presale_stage2_active;
  stage2_cap    := v_cfg.presale_stage2_cap;
  sold_out      := committed >= capacity;
  return next;
end;
$$;

-- --- create_order: tope de aforo total para todas las tarifas -----------------

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
  v_cfg             event_config;
  v_capacity        int;
  v_committed       int;
  v_total_committed int;
  v_order           orders;
begin
  -- Serialize EVERY capacity decision on the single config row: general now
  -- has a hard cap too (total_capacity), not just presale.
  select * into v_cfg from event_config where id = 1 for update;

  select coalesce(sum(quantity), 0) into v_total_committed
  from orders
  where status = 'paid'
     or (status = 'pending' and reservation_expires_at > now());

  if v_total_committed + p_quantity > v_cfg.total_capacity then
    raise exception 'EVENT_SOLD_OUT'
      using errcode = 'P0001',
            detail  = format('available=%s requested=%s',
                             greatest(v_cfg.total_capacity - v_total_committed, 0), p_quantity);
  end if;

  if p_tier = 'preventa' then
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
