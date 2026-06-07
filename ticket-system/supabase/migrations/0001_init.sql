-- =============================================================================
-- WWWY3 Ticket System — initial schema + atomic RPCs
-- =============================================================================
-- Run this against the Supabase project (SQL editor or `supabase db push`).
-- All access is server-side via the service-role key, so Row Level Security is
-- enabled with NO permissive policies: the service role bypasses RLS, and the
-- anon/public key gets zero access. The frontend never talks to Supabase
-- directly; it only calls our serverless functions.
-- =============================================================================

-- --- Tables ------------------------------------------------------------------

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  buyer_name     text not null,
  buyer_email    text not null,
  buyer_phone    text,
  tier           text not null check (tier in ('preventa','general')),
  quantity       int  not null default 1 check (quantity > 0),
  total_cents    int  not null,
  payment_method text not null check (payment_method in ('yappy','cuantoapp','cash')),
  payment_ref    text,
  status         text not null default 'pending'
                   check (status in ('pending','paid','cancelled')),
  created_at     timestamptz not null default now(),
  paid_at        timestamptz,
  -- when the held presale cupo for a pending order is released
  reservation_expires_at timestamptz,
  -- set once the confirmation email (with QRs) has been sent; makes issuance
  -- safely retryable / idempotent (re-marking paid never re-sends)
  emailed_at     timestamptz
);

create table if not exists event_config (
  id                      int primary key default 1 check (id = 1), -- single row
  presale_stage1_cap      int not null default 75,
  presale_stage2_cap      int not null default 75,
  presale_stage2_active   boolean not null default false,
  updated_at              timestamptz not null default now()
);

create table if not exists tickets (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  tier        text not null check (tier in ('preventa','general')),
  status      text not null default 'valid' check (status in ('valid','used','void')),
  used_at     timestamptz,
  used_by     text,            -- identifier of the staff/station that validated
  created_at  timestamptz not null default now()
);

-- Seed the single config row.
insert into event_config (id) values (1) on conflict (id) do nothing;

-- --- Indexes -----------------------------------------------------------------

create index if not exists orders_status_idx        on orders (status);
create index if not exists orders_tier_status_idx   on orders (tier, status);
create index if not exists orders_email_idx          on orders (lower(buyer_email));
create index if not exists orders_created_idx        on orders (created_at desc);
create index if not exists tickets_order_idx         on tickets (order_id);
create index if not exists tickets_status_idx        on tickets (status);

-- --- Row Level Security (lock everything down) -------------------------------

alter table orders       enable row level security;
alter table event_config enable row level security;
alter table tickets      enable row level security;
-- No policies => only the service role (which bypasses RLS) can read/write.

-- =============================================================================
-- RPCs — all capacity / issuance logic that must be atomic lives here.
-- =============================================================================

-- --- Presale capacity snapshot ----------------------------------------------
-- Returns the current presale numbers in a single consistent read.
create or replace function presale_status()
returns table (
  capacity      int,
  paid_count    int,
  pending_count int,
  committed     int,
  available     int,
  stage2_active boolean,
  sold_out      boolean
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

  committed     := paid_count + pending_count;
  available     := greatest(capacity - committed, 0);
  stage2_active := v_cfg.presale_stage2_active;
  sold_out      := committed >= capacity;
  return next;
end;
$$;

-- --- Atomic order creation with race-safe presale capacity check ------------
-- For 'preventa' we take a row lock on the single event_config row, which
-- serializes every concurrent presale purchase. This makes the
-- "count then insert" sequence atomic: two near-simultaneous orders cannot
-- both slip past the cap. 'general' tier skips the lock (capped by venue, not
-- here). Raises a custom exception when the cupo would be exceeded.
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

-- --- Mark an order paid + issue tickets (idempotent) ------------------------
-- Transitions pending -> paid and creates one ticket per admission. Safe to
-- call repeatedly: the status transition only fires once, and tickets are only
-- created when none exist for the order. Returns the order plus a flag telling
-- the caller whether THIS call was the transition that flipped it to paid
-- (so the caller knows whether fresh work happened — emailing is gated
-- separately on orders.emailed_at).
create or replace function mark_order_paid(
  p_order_id    uuid,
  p_payment_ref text
)
returns orders
language plpgsql
as $$
declare
  v_order    orders;
  v_existing int;
begin
  update orders
    set status      = 'paid',
        paid_at     = coalesce(paid_at, now()),
        payment_ref = coalesce(p_payment_ref, payment_ref)
    where id = p_order_id and status = 'pending'
    returning * into v_order;

  if not found then
    select * into v_order from orders where id = p_order_id;
    if v_order.id is null then
      raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_order.status = 'cancelled' then
      raise exception 'ORDER_CANCELLED' using errcode = 'P0003';
    end if;
    -- else: already 'paid' — fall through, tickets guard below is idempotent
  end if;

  select count(*) into v_existing from tickets where order_id = p_order_id;
  if v_existing = 0 then
    insert into tickets (order_id, tier, status)
    select v_order.id, v_order.tier, 'valid'
    from generate_series(1, v_order.quantity);
  end if;

  return v_order;
end;
$$;

-- --- Mark the confirmation email as sent ------------------------------------
create or replace function mark_order_emailed(p_order_id uuid)
returns void
language sql
as $$
  update orders set emailed_at = coalesce(emailed_at, now()) where id = p_order_id;
$$;

-- --- Atomic ticket validation (anti double-use) -----------------------------
-- Wins the race between simultaneous scans: only the first UPDATE flips
-- valid -> used. Returns a single classified row describing the outcome so the
-- gate UI can render green/red without a second round-trip.
create or replace function validate_ticket(
  p_ticket_id uuid,
  p_used_by   text
)
returns table (
  result   text,        -- 'valid' | 'already_used' | 'void' | 'not_found'
  ticket_id uuid,
  tier     text,
  used_at  timestamptz,
  used_by  text,
  buyer_name text
)
language plpgsql
as $$
declare
  v_ticket tickets;
begin
  update tickets
    set status  = 'used',
        used_at = now(),
        used_by = p_used_by
    where id = p_ticket_id and status = 'valid'
    returning * into v_ticket;

  if found then
    result := 'valid';
  else
    select * into v_ticket from tickets where id = p_ticket_id;
    if v_ticket.id is null then
      result := 'not_found';
      return next;
      return;
    elsif v_ticket.status = 'used' then
      result := 'already_used';
    else
      result := 'void';
    end if;
  end if;

  ticket_id := v_ticket.id;
  tier      := v_ticket.tier;
  used_at   := v_ticket.used_at;
  used_by   := v_ticket.used_by;
  select o.buyer_name into buyer_name from orders o where o.id = v_ticket.order_id;
  return next;
end;
$$;

-- --- Release cupo from expired pending orders -------------------------------
create or replace function cleanup_expired_orders()
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  with cancelled as (
    update orders
      set status = 'cancelled'
      where status = 'pending'
        and reservation_expires_at is not null
        and reservation_expires_at < now()
      returning 1
  )
  select count(*) into v_count from cancelled;
  return v_count;
end;
$$;
