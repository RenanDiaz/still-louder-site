-- =============================================================================
-- Multi-evento: tabla `events` + `event_tier` (spec: docs/features/multi-evento.md)
-- =============================================================================
-- Hasta aquí el sistema tenía UN evento implícito (WWWY3): cupo/aforo en la
-- fila única `event_config`, fechas y precios en código, prefijo del QR fijo.
-- Esta migración convierte cada show en una fila:
--
--   events      fechas, caps de preventa, aforo, estado, copy básico, tema
--   event_tier  precio por tarifa vendible (preventa / general) por evento
--
-- y agrega `event_id` (NOT NULL) a orders, tickets y gift_campaign. Toda orden,
-- entrada y campaña pertenece a exactamente un evento, y una entrada siempre
-- lleva el event_id de su orden (lo copia mark_order_paid).
--
-- Los RPC de cupo (create_order, presale_status) pasan a recibir p_event_id y
-- serializan con `for update` sobre la fila del evento — misma semántica que
-- 0004/0007/0010, solo scopeada. claim_gift saca el evento de la campaña.
-- Al final se elimina event_config.
--
-- Aplicar en UNA transacción (el SQL editor de Supabase ya lo hace por
-- sentencia; con psql usar --single-transaction). Clonar producción y probar
-- antes de correrla en el proyecto real.
-- =============================================================================

-- --- Tablas ------------------------------------------------------------------

create table if not exists events (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique
                          check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  code                  text not null unique
                          check (code ~ '^[A-Z0-9]{3,8}$'),
  name                  text not null,
  short_name            text not null,
  venue                 text,
  venue_address         text,
  starts_at             timestamptz not null,
  presale_start         timestamptz not null,
  presale_end           timestamptz not null,
  sales_end             timestamptz not null,
  event_end             timestamptz not null,
  presale_stage1_cap    int  not null default 75 check (presale_stage1_cap >= 0),
  presale_stage2_cap    int  not null default 25 check (presale_stage2_cap >= 0),
  presale_stage2_active boolean not null default false,
  total_capacity        int  not null default 230 check (total_capacity > 0),
  status                text not null default 'draft'
                          check (status in ('draft', 'teaser', 'on_sale', 'archived')),
  theme                 text not null default 'default'
                          check (theme ~ '^[a-z0-9-]+$'),
  og_image_url          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint events_dates_order check (
    presale_start <= presale_end
    and presale_end <= sales_end
    and sales_end <= event_end
  )
);

create table if not exists event_tier (
  event_id    uuid not null references events(id) on delete cascade,
  tier        text not null check (tier in ('preventa', 'general')),
  price_cents int  not null check (price_cents >= 0),
  primary key (event_id, tier)
);

create index if not exists events_status_idx on events (status, starts_at);

alter table events     enable row level security;
alter table event_tier enable row level security;
-- Sin policies: solo el service role accede, como el resto del esquema.

-- --- Backfill: WWWY3 (hasta hoy en event_config + constantes de código) ------

insert into events (
  slug, code, name, short_name, venue, venue_address,
  starts_at, presale_start, presale_end, sales_end, event_end,
  presale_stage1_cap, presale_stage2_cap, presale_stage2_active, total_capacity,
  status, theme
)
select
  'when-we-were-young-3', 'WWWY3', 'When We Were Young 3', 'WWWY3', 'Hops',
  'Hops, Ciudad de Panamá, Panamá',
  '2026-08-01T20:00:00-05:00', '2026-06-15T00:00:00-05:00',
  '2026-08-01T00:00:00-05:00', '2026-08-02T02:00:00-05:00',
  '2026-08-02T06:00:00-05:00',
  c.presale_stage1_cap, c.presale_stage2_cap, c.presale_stage2_active, c.total_capacity,
  'archived', 'wwwy3'
from event_config c
where c.id = 1
on conflict (slug) do nothing;

insert into event_tier (event_id, tier, price_cents)
select e.id, t.tier, t.price_cents
from events e
cross join (values ('preventa', 600), ('general', 800)) as t(tier, price_cents)
where e.code = 'WWWY3'
on conflict do nothing;

-- Show del 31 de octubre: sembrado en 'teaser' para que /31-10 siga mostrando
-- el teaser tras el deploy (el archivo estático 31-10.html se elimina). Nombre,
-- lugar, código, precios y caps son PROVISIONALES: se editan desde la pestaña
-- Eventos del admin antes de pasarlo a 'on_sale' (el código solo se puede
-- cambiar mientras no haya entradas emitidas).
insert into events (
  slug, code, name, short_name, venue, venue_address,
  starts_at, presale_start, presale_end, sales_end, event_end, status, theme
)
values (
  '31-10', 'SL3110', 'Still Louder · 31 de octubre', '31-10', null, null,
  '2026-10-31T20:00:00-05:00', '2026-10-01T00:00:00-05:00',
  '2026-10-31T00:00:00-05:00', '2026-11-01T02:00:00-05:00',
  '2026-11-01T06:00:00-05:00', 'teaser', 'mono'
)
on conflict (slug) do nothing;

insert into event_tier (event_id, tier, price_cents)
select e.id, t.tier, t.price_cents
from events e
cross join (values ('preventa', 600), ('general', 800)) as t(tier, price_cents)
where e.slug = '31-10'
on conflict do nothing;

-- --- event_id en orders / tickets / gift_campaign ----------------------------

alter table orders        add column if not exists event_id uuid references events(id);
alter table tickets       add column if not exists event_id uuid references events(id);
alter table gift_campaign add column if not exists event_id uuid references events(id);

update orders        set event_id = (select id from events where code = 'WWWY3') where event_id is null;
update tickets       set event_id = (select id from events where code = 'WWWY3') where event_id is null;
update gift_campaign set event_id = (select id from events where code = 'WWWY3') where event_id is null;

alter table orders        alter column event_id set not null;
alter table tickets       alter column event_id set not null;
alter table gift_campaign alter column event_id set not null;

create index if not exists orders_event_status_idx  on orders (event_id, status);
create index if not exists tickets_event_status_idx on tickets (event_id, status);
create index if not exists gift_campaign_event_idx  on gift_campaign (event_id);

-- --- presale_status(p_event_id) ------------------------------------------------
-- Mismas columnas y semántica que 0010, contando solo las órdenes del evento.

drop function if exists presale_status();

create function presale_status(p_event_id uuid)
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
  v_ev events;
begin
  select * into v_ev from events where id = p_event_id;
  if v_ev.id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0005';
  end if;

  capacity := v_ev.presale_stage1_cap +
    case when v_ev.presale_stage2_active then v_ev.presale_stage2_cap else 0 end;

  select coalesce(sum(quantity), 0) into paid_count
  from orders where event_id = p_event_id and tier = 'preventa' and status = 'paid';

  select coalesce(sum(quantity), 0) into pending_count
  from orders
  where event_id = p_event_id
    and tier = 'preventa'
    and status = 'pending'
    and reservation_expires_at > now();

  select coalesce(sum(quantity), 0) into courtesy_count
  from orders where event_id = p_event_id and tier = 'cortesia' and status = 'paid';

  select coalesce(sum(quantity), 0) into total_committed
  from orders
  where event_id = p_event_id
    and (status = 'paid'
         or (status = 'pending' and reservation_expires_at > now()));

  total_capacity  := v_ev.total_capacity;
  total_available := greatest(v_ev.total_capacity - total_committed, 0);
  event_sold_out  := total_committed >= v_ev.total_capacity;

  committed     := paid_count + pending_count + courtesy_count;
  available     := least(greatest(capacity - committed, 0), total_available);
  stage2_active := v_ev.presale_stage2_active;
  stage2_cap    := v_ev.presale_stage2_cap;
  sold_out      := committed >= capacity;
  return next;
end;
$$;

-- --- create_order(p_event_id, ...) ---------------------------------------------
-- Firma nueva (p_event_id primero): dropear la de 0005/0010 para no dejar una
-- sobrecarga ambigua. El `for update` pasa a la fila del evento, así que dos
-- eventos no se serializan entre sí pero cada uno sigue siendo race-safe.

drop function if exists create_order(text, text, text, text, int, int, int, int, text, int);

create function create_order(
  p_event_id            uuid,
  p_buyer_name          text,
  p_buyer_email         text,
  p_buyer_phone         text,
  p_tier                text,
  p_quantity            int,
  p_total_cents         int,
  p_net_cents           int,
  p_fee_cents           int,
  p_payment_method      text,
  p_reservation_minutes int
)
returns orders
language plpgsql
as $$
declare
  v_ev              events;
  v_capacity        int;
  v_committed       int;
  v_total_committed int;
  v_order           orders;
begin
  select * into v_ev from events where id = p_event_id for update;
  if v_ev.id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0005';
  end if;

  select coalesce(sum(quantity), 0) into v_total_committed
  from orders
  where event_id = p_event_id
    and (status = 'paid'
         or (status = 'pending' and reservation_expires_at > now()));

  if v_total_committed + p_quantity > v_ev.total_capacity then
    raise exception 'EVENT_SOLD_OUT'
      using errcode = 'P0001',
            detail  = format('available=%s requested=%s',
                             greatest(v_ev.total_capacity - v_total_committed, 0), p_quantity);
  end if;

  if p_tier = 'preventa' then
    v_capacity := v_ev.presale_stage1_cap +
      case when v_ev.presale_stage2_active then v_ev.presale_stage2_cap else 0 end;

    select coalesce(sum(quantity), 0) into v_committed
    from orders
    where event_id = p_event_id
      and ((tier = 'preventa'
            and (status = 'paid'
                 or (status = 'pending' and reservation_expires_at > now())))
           or (tier = 'cortesia' and status = 'paid'));

    if v_committed + p_quantity > v_capacity then
      raise exception 'PRESALE_SOLD_OUT'
        using errcode = 'P0001',
              detail  = format('available=%s requested=%s',
                               greatest(v_capacity - v_committed, 0), p_quantity);
    end if;
  end if;

  insert into orders (
    event_id, buyer_name, buyer_email, buyer_phone, tier, quantity,
    total_cents, net_cents, fee_cents, payment_method, status, reservation_expires_at
  )
  values (
    p_event_id, p_buyer_name, p_buyer_email, p_buyer_phone, p_tier, p_quantity,
    p_total_cents, p_net_cents, p_fee_cents, p_payment_method, 'pending',
    now() + make_interval(mins => p_reservation_minutes)
  )
  returning * into v_order;

  return v_order;
end;
$$;

-- --- mark_order_paid: los tickets heredan el event_id de la orden -------------
-- Misma firma y lógica que 0001; solo cambia el INSERT de tickets.

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
  end if;

  select count(*) into v_existing from tickets where order_id = p_order_id;
  if v_existing = 0 then
    insert into tickets (order_id, event_id, tier, status)
    select v_order.id, v_order.event_id, v_order.tier, 'valid'
    from generate_series(1, v_order.quantity);
  end if;

  return v_order;
end;
$$;

-- --- claim_gift: la orden $0 nace en el evento de la campaña ------------------
-- Misma firma y lógica race-safe que 0009. Además: si el evento de la campaña
-- no está 'on_sale' o ya pasó su sales_end, responde 'closed' sin consumir cupo.

create or replace function claim_gift(
  p_token text,
  p_name  text,
  p_email text,
  p_phone text,
  p_ip    text
)
returns table (status text, order_id uuid)
language plpgsql
as $$
declare
  v_campaign gift_campaign;
  v_ev       events;
  v_order    orders;
begin
  select * into v_campaign from gift_campaign where token = p_token for update;

  if v_campaign.id is null then
    status := 'not_found';
    return next;
    return;
  end if;

  select * into v_ev from events where id = v_campaign.event_id;
  if v_ev.status <> 'on_sale' or now() >= v_ev.sales_end then
    status := 'closed';
    return next;
    return;
  end if;

  if v_campaign.status <> 'active' then
    status := v_campaign.status;
    return next;
    return;
  end if;

  if exists (
    select 1 from gift_claim
    where campaign_id = v_campaign.id and lower(email) = lower(p_email)
  ) then
    status := 'already_claimed';
    return next;
    return;
  end if;

  update gift_campaign
    set claimed_count = claimed_count + 1,
        status = case
                   when claimed_count + 1 >= max_gifts then 'exhausted'
                   else 'active'
                 end
    where id = v_campaign.id
      and gift_campaign.status = 'active'
      and claimed_count < max_gifts
    returning * into v_campaign;

  if not found then
    status := 'exhausted';
    return next;
    return;
  end if;

  insert into orders (
    event_id, buyer_name, buyer_email, buyer_phone, tier, quantity,
    total_cents, net_cents, fee_cents, payment_method, status
  )
  values (
    v_campaign.event_id, p_name, p_email, p_phone, 'regalo', 1,
    0, 0, 0, 'gift', 'pending'
  )
  returning * into v_order;

  insert into gift_claim (campaign_id, name, email, phone, order_id, claimer_ip)
  values (v_campaign.id, p_name, p_email, p_phone, v_order.id, p_ip);

  status   := 'claimed';
  order_id := v_order.id;
  return next;
end;
$$;

-- cleanup_expired_orders, validate_ticket, refund_order y mark_order_emailed no
-- cambian: operan por id (o sobre todos los eventos, en el caso del cleanup).

-- --- Retirar event_config ----------------------------------------------------
drop table if exists event_config;
