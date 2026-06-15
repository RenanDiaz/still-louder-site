-- =============================================================================
-- WWWY3 Ticket System — refunds
-- =============================================================================
-- Adds a 'refunded' order status plus the columns and atomic RPC that back the
-- admin "Reembolsar" action. Refunding a paid order is the money-side mirror of
-- revoking its tickets: the order leaves 'paid' (so it drops out of the revenue
-- reports, which only count status='paid') and every still-valid ticket is
-- voided in the SAME transaction, so the gate rejects them immediately. Used
-- tickets are left untouched — someone already inside cannot be un-admitted.
--
-- The Yappy money reversal itself happens BEFORE this RPC, in the serverless
-- layer (api/_lib/refund.ts -> reverseYappyPayment); this migration only records
-- the outcome. For cash/CuantoApp (or when Yappy's "en tránsito" window has
-- closed) the admin marks the refund manually and settles the money out-of-band.
-- =============================================================================

-- --- Status enum + bookkeeping columns ---------------------------------------
-- The inline CHECK from 0001 is auto-named orders_status_check; swap it for one
-- that also allows 'refunded'.
alter table orders drop constraint if exists orders_status_check;
alter table orders
  add constraint orders_status_check
  check (status in ('pending', 'paid', 'cancelled', 'refunded'));

alter table orders add column if not exists refunded_at timestamptz;
-- Free-text reference for the refund: Yappy's transactionId on an API reversal,
-- or whatever the admin types when settling manually.
alter table orders add column if not exists refund_ref text;

-- --- Atomic refund -----------------------------------------------------------
-- paid -> refunded plus voiding the order's valid tickets, in one transaction.
-- Idempotent: a second call on an already-refunded order is a no-op that returns
-- the row. Raises ORDER_NOT_FOUND / ORDER_NOT_PAID so the caller can classify.
create or replace function refund_order(
  p_order_id   uuid,
  p_refund_ref text
)
returns orders
language plpgsql
as $$
declare
  v_order orders;
begin
  update orders
    set status      = 'refunded',
        refunded_at = now(),
        refund_ref  = coalesce(p_refund_ref, refund_ref)
    where id = p_order_id and status = 'paid'
    returning * into v_order;

  if not found then
    select * into v_order from orders where id = p_order_id;
    if v_order.id is null then
      raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
    end if;
    -- Already refunded: idempotent success (tickets were voided on the first call).
    if v_order.status = 'refunded' then
      return v_order;
    end if;
    raise exception 'ORDER_NOT_PAID' using errcode = 'P0004';
  end if;

  -- Void every still-valid ticket; leave 'used' ones as audit (already inside).
  update tickets set status = 'void'
    where order_id = p_order_id and status = 'valid';

  return v_order;
end;
$$;
