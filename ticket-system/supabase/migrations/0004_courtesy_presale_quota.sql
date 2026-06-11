-- =============================================================================
-- WWWY3 — Las cortesías restan cupo de preventa
-- =============================================================================
-- Cambio de política respecto a 0003: las cortesías SÍ consumen cupo de
-- preventa (ej.: quedan 70 disponibles y se generan 5 cortesías → quedan 65).
-- Implementación: presale_status() y create_order() suman también las órdenes
-- tier = 'cortesia' pagadas dentro del cupo comprometido. No hace falta filtrar
-- por fecha de emisión: cerrada la preventa por fecha, el tier 'preventa' ya no
-- se vende (gate en api/orders.ts), así que el contador deja de gatear ventas.
--
-- Las cortesías NO se bloquean por cupo — son una decisión deliberada del
-- admin: si exceden la capacidad, available queda clavado en 0 y la preventa
-- aparece agotada para el público.
-- =============================================================================

-- El tipo de retorno cambia (se añade courtesy_count), así que CREATE OR
-- REPLACE no sirve: hay que dropear y recrear.
drop function if exists presale_status();

create function presale_status()
returns table (
  capacity       int,
  paid_count     int,
  pending_count  int,
  courtesy_count int,
  committed      int,
  available      int,
  stage2_active  boolean,
  sold_out       boolean
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

  committed     := paid_count + pending_count + courtesy_count;
  available     := greatest(capacity - committed, 0);
  stage2_active := v_cfg.presale_stage2_active;
  sold_out      := committed >= capacity;
  return next;
end;
$$;

-- Misma definición que 0001 salvo el conteo de cupo comprometido, que ahora
-- incluye las cortesías pagadas.
create or replace function create_order(
  p_buyer_name         text,
  p_buyer_email        text,
  p_buyer_phone        text,
  p_tier               text,
  p_quantity           int,
  p_total_cents        int,
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
    total_cents, payment_method, status, reservation_expires_at
  )
  values (
    p_buyer_name, p_buyer_email, p_buyer_phone, p_tier, p_quantity,
    p_total_cents, p_payment_method, 'pending',
    now() + make_interval(mins => p_reservation_minutes)
  )
  returning * into v_order;

  return v_order;
end;
$$;
