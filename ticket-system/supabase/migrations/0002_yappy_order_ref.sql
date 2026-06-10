-- =============================================================================
-- WWWY3 Ticket System — Yappy Botón de Pago V2 support
-- =============================================================================
-- Yappy's `orderId` is limited to 15 alphanumeric characters, so we cannot send
-- our UUID (36 chars). Every order gets a short unique `order_ref` ("WW" + 10
-- chars from an unambiguous A-Z/2-9 alphabet = 12 chars) which is what Yappy
-- sees; the IPN resolves order_ref -> order. `yappy_transaction_id` stores the
-- transactionId returned by /payments/payment-wc for audit / reconciliation
-- (the IPN's confirmationNumber lands in the existing payment_ref column).
-- =============================================================================

alter table orders add column if not exists order_ref text unique;
alter table orders add column if not exists yappy_transaction_id text;

-- --- Short order-ref generator ------------------------------------------------
-- Alphabet drops 0/O/1/I to keep refs readable if dictated over the phone.
-- 32^10 combinations make collisions vanishingly rare; the loop + the unique
-- constraint make them impossible.
create or replace function generate_order_ref()
returns text
language plpgsql
volatile
as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_ref   text;
begin
  loop
    v_ref := 'WW';
    for i in 1..10 loop
      v_ref := v_ref || substr(v_chars, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from orders where order_ref = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- Backfill refs for orders created before this migration.
update orders set order_ref = generate_order_ref() where order_ref is null;

-- --- create_order: assign order_ref at creation -------------------------------
-- Same body as 0001 plus the order_ref column. Capacity logic unchanged.
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
    where tier = 'preventa'
      and (status = 'paid'
           or (status = 'pending' and reservation_expires_at > now()));

    if v_committed + p_quantity > v_capacity then
      raise exception 'PRESALE_SOLD_OUT'
        using errcode = 'P0001',
              detail  = format('available=%s requested=%s',
                               greatest(v_capacity - v_committed, 0), p_quantity);
    end if;
  end if;

  insert into orders (
    buyer_name, buyer_email, buyer_phone, tier, quantity,
    total_cents, payment_method, status, reservation_expires_at, order_ref
  )
  values (
    p_buyer_name, p_buyer_email, p_buyer_phone, p_tier, p_quantity,
    p_total_cents, p_payment_method, 'pending',
    now() + make_interval(mins => p_reservation_minutes),
    generate_order_ref()
  )
  returning * into v_order;

  return v_order;
end;
$$;
