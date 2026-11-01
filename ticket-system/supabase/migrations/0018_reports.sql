-- =============================================================================
-- Reportes del admin (docs/features/reportes-admin.md)
-- =============================================================================
-- Funciones de SOLO LECTURA que agregan en Postgres (D1): el Worker ya no suma
-- filas traídas por PostgREST, que se truncan en silencio al `max_rows` del
-- proyecto. Sin tablas nuevas; los índices (event_id, status) existen desde 0011.
--
-- Zona horaria (D3): todo corte por día/hora es en America/Panama (UTC−5, sin
-- horario de verano), con `ts at time zone 'America/Panama'`.
--
-- Dinero (D4): una orden cuenta el día de su `paid_at`; un reembolso resta el
-- día de su `refunded_at` (refund_order conserva paid_at). Así la serie diaria
-- cuadra con el cierre, que solo suma status = 'paid'.
--
-- Las comisiones del procesador NO se calculan aquí: la tabla de comisiones
-- vive en api/_lib/pricing.ts (D5). Estas funciones devuelven conteos y sumas;
-- el TS deriva comisión estimada, comisión perdida (D11) y depósito esperado.
-- =============================================================================

-- --- Cierre: órdenes agrupadas ---------------------------------------------------
-- Una fila por (status, tier, payment_method, refunded_same_day).
--   status: el de la orden, salvo que una pending ya vencida sale 'expired'
--           (las vigentes quedan 'pending').
--   refunded_same_day: solo para status 'refunded' — ¿el reembolso cayó el
--           mismo día de Panamá que el pago? (D11). NULL en el resto.
create or replace function report_settlement(p_event_id uuid)
returns table (
  status            text,
  tier              text,
  payment_method    text,
  refunded_same_day boolean,
  orders            int,
  tickets           int,
  total_cents       bigint,
  net_cents         bigint,
  fee_cents         bigint
)
language sql
stable
as $$
  select
    case when o.status = 'pending' and o.reservation_expires_at <= now() then 'expired'
         else o.status end,
    o.tier,
    o.payment_method,
    case when o.status = 'refunded' then
      (o.paid_at at time zone 'America/Panama')::date
        = (o.refunded_at at time zone 'America/Panama')::date
    end,
    count(*)::int,
    coalesce(sum(o.quantity), 0)::int,
    coalesce(sum(o.total_cents), 0)::bigint,
    coalesce(sum(o.net_cents), 0)::bigint,
    coalesce(sum(o.fee_cents), 0)::bigint
  from orders o
  where o.event_id = p_event_id
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4;
$$;

-- --- Cierre: listas de órdenes ------------------------------------------------------
-- Órdenes que el cierre muestra una por una. Una orden puede salir en más de
-- un `kind`. El cliente pagina con .range(): nunca se trunca en silencio.
--   refunded      reembolsadas (con fechas para aplicar D11)
--   cash          pagadas en efectivo (nota libre en payment_ref, D12)
--   void_unpaid   pagadas con entradas anuladas sin reembolso (revocadas a mano)
--   pending       pendientes vigentes (dinero aún no cobrado)
create or replace function report_settlement_lists(p_event_id uuid)
returns table (
  kind                   text,
  order_id               uuid,
  buyer_name             text,
  tier                   text,
  payment_method         text,
  quantity               int,
  total_cents            int,
  net_cents              int,
  created_at             timestamptz,
  paid_at                timestamptz,
  refunded_at            timestamptz,
  reservation_expires_at timestamptz,
  payment_ref            text,
  refund_ref             text,
  void_tickets           int
)
language sql
stable
as $$
  with voids as (
    select t.order_id, count(*)::int as n
    from tickets t
    where t.event_id = p_event_id and t.status = 'void'
    group by t.order_id
  )
  select k.kind, o.id, o.buyer_name, o.tier, o.payment_method, o.quantity,
         o.total_cents, o.net_cents, o.created_at, o.paid_at, o.refunded_at,
         o.reservation_expires_at, o.payment_ref, o.refund_ref,
         coalesce(v.n, 0)
  from orders o
  left join voids v on v.order_id = o.id
  cross join lateral (
    select 'refunded'::text as kind where o.status = 'refunded'
    union all
    select 'cash' where o.status = 'paid' and o.payment_method = 'cash'
    union all
    select 'void_unpaid' where o.status = 'paid' and coalesce(v.n, 0) > 0
    union all
    select 'pending' where o.status = 'pending' and o.reservation_expires_at > now()
  ) k
  where o.event_id = p_event_id
  order by k.kind, coalesce(o.paid_at, o.created_at), o.id;
$$;

-- --- Entradas: desglose por tarifa, estado y estación --------------------------------
-- Base del bloque de asistencia del cierre y de los cortes por tarifa/estación
-- del reporte de check-in. `used_by` es el texto libre de /validar.
create or replace function report_ticket_breakdown(p_event_id uuid)
returns table (tier text, status text, used_by text, tickets int)
language sql
stable
as $$
  select t.tier, t.status, case when t.status = 'used' then t.used_by end, count(*)::int
  from tickets t
  where t.event_id = p_event_id
  group by 1, 2, 3
  order by 1, 2, 3;
$$;

-- --- Check-in por franja --------------------------------------------------------------
-- Entradas validadas por franja de p_bucket_minutes (hora local de Panamá),
-- desde la primera hasta la última, incluyendo franjas en cero.
create or replace function report_checkin_slots(p_event_id uuid, p_bucket_minutes int default 15)
returns table (slot timestamp, tickets int)
language sql
stable
as $$
  with used as (
    select date_bin(make_interval(mins => p_bucket_minutes),
                    t.used_at at time zone 'America/Panama',
                    timestamp '2000-01-01') as slot
    from tickets t
    where t.event_id = p_event_id and t.status = 'used' and t.used_at is not null
  ),
  bounds as (select min(slot) as lo, max(slot) as hi from used)
  select s.slot, coalesce(count(u.slot), 0)::int
  from bounds b
  cross join lateral generate_series(b.lo, b.hi, make_interval(mins => p_bucket_minutes)) as s(slot)
  left join used u on u.slot = s.slot
  where b.lo is not null
  group by s.slot
  order by s.slot;
$$;

-- --- Ventas por día ------------------------------------------------------------------
-- Una fila por día de Panamá, incluyendo días en cero, desde el primer día con
-- actividad (o presale_start) hasta hoy/sales_end — y más allá si hubo pagos o
-- reembolsos después (un reembolso tardío tiene que aparecer para que cuadre).
-- "Pagadas" = status paid o refunded (ambas tuvieron paid_at); los reembolsos
-- restan en su propio día. cortesia/regalo se cuentan aparte (free_tickets).
create or replace function report_sales_daily(p_event_id uuid)
returns table (
  day              date,
  paid_orders      int,
  preventa_tickets int,
  general_tickets  int,
  free_tickets     int,
  gross_cents      bigint,
  net_cents        bigint,
  net_yappy        bigint,
  net_cuantoapp    bigint,
  net_cash         bigint,
  refunded_orders  int,
  refunded_tickets int,
  refunded_net     bigint
)
language sql
stable
as $$
  with ev as (
    select (presale_start at time zone 'America/Panama')::date as d_start,
           (sales_end     at time zone 'America/Panama')::date as d_end
    from events where id = p_event_id
  ),
  paid as (
    select (o.paid_at at time zone 'America/Panama')::date as day, o.*
    from orders o
    where o.event_id = p_event_id and o.status in ('paid', 'refunded') and o.paid_at is not null
  ),
  refunds as (
    select (o.refunded_at at time zone 'America/Panama')::date as day, o.quantity, o.net_cents
    from orders o
    where o.event_id = p_event_id and o.status = 'refunded' and o.refunded_at is not null
  ),
  bounds as (
    select
      least(ev.d_start,
            (select min((created_at at time zone 'America/Panama')::date) from orders where event_id = p_event_id)
      ) as lo,
      greatest(least((now() at time zone 'America/Panama')::date, ev.d_end),
               (select max(day) from paid),
               (select max(day) from refunds)
      ) as hi
    from ev
  ),
  days as (
    select generate_series(b.lo, b.hi, interval '1 day')::date as day
    from bounds b
    where b.lo <= b.hi
  ),
  p as (
    select day,
           count(*) filter (where tier in ('preventa', 'general'))::int as paid_orders,
           coalesce(sum(quantity) filter (where tier = 'preventa'), 0)::int as preventa_tickets,
           coalesce(sum(quantity) filter (where tier = 'general'), 0)::int as general_tickets,
           coalesce(sum(quantity) filter (where tier in ('cortesia', 'regalo')), 0)::int as free_tickets,
           coalesce(sum(total_cents), 0)::bigint as gross_cents,
           coalesce(sum(net_cents), 0)::bigint as net_cents,
           coalesce(sum(net_cents) filter (where payment_method = 'yappy'), 0)::bigint as net_yappy,
           coalesce(sum(net_cents) filter (where payment_method = 'cuantoapp'), 0)::bigint as net_cuantoapp,
           coalesce(sum(net_cents) filter (where payment_method = 'cash'), 0)::bigint as net_cash
    from paid
    group by day
  ),
  r as (
    select day, count(*)::int as refunded_orders, coalesce(sum(quantity), 0)::int as refunded_tickets,
           coalesce(sum(net_cents), 0)::bigint as refunded_net
    from refunds
    group by day
  )
  select d.day,
         coalesce(p.paid_orders, 0), coalesce(p.preventa_tickets, 0), coalesce(p.general_tickets, 0),
         coalesce(p.free_tickets, 0), coalesce(p.gross_cents, 0), coalesce(p.net_cents, 0),
         coalesce(p.net_yappy, 0), coalesce(p.net_cuantoapp, 0), coalesce(p.net_cash, 0),
         coalesce(r.refunded_orders, 0), coalesce(r.refunded_tickets, 0), coalesce(r.refunded_net, 0)
  from days d
  left join p on p.day = d.day
  left join r on r.day = d.day
  order by d.day;
$$;

-- --- Comparativo entre eventos ---------------------------------------------------------
-- Una fila por evento no draft, más reciente primero. sold_out_at = primer
-- paid_at en que las entradas de órdenes pagadas (incl. cortesías/regalos)
-- acumuladas alcanzan total_capacity; NULL si nunca.
create or replace function report_events_comparison()
returns table (
  event_id         uuid,
  slug             text,
  name             text,
  status           text,
  starts_at        timestamptz,
  event_end        timestamptz,
  presale_start    timestamptz,
  sales_end        timestamptz,
  total_capacity   int,
  preventa_sold    int,
  general_sold     int,
  free_issued      int,
  gross_cents      bigint,
  net_cents        bigint,
  refunded_orders  int,
  refunded_cents   bigint,
  issued_tickets   int,
  used_tickets     int,
  sold_out_at      timestamptz
)
language sql
stable
as $$
  with o as (
    select o.event_id,
           coalesce(sum(o.quantity) filter (where o.status = 'paid' and o.tier = 'preventa'), 0)::int as preventa_sold,
           coalesce(sum(o.quantity) filter (where o.status = 'paid' and o.tier = 'general'), 0)::int as general_sold,
           coalesce(sum(o.quantity) filter (where o.status = 'paid' and o.tier in ('cortesia', 'regalo')), 0)::int
             as free_issued,
           coalesce(sum(o.total_cents) filter (where o.status = 'paid'), 0)::bigint as gross_cents,
           coalesce(sum(o.net_cents) filter (where o.status = 'paid'), 0)::bigint as net_cents,
           count(*) filter (where o.status = 'refunded')::int as refunded_orders,
           coalesce(sum(o.total_cents) filter (where o.status = 'refunded'), 0)::bigint as refunded_cents
    from orders o
    group by o.event_id
  ),
  t as (
    select t.event_id,
           count(*) filter (where t.status <> 'void')::int as issued_tickets,
           count(*) filter (where t.status = 'used')::int as used_tickets
    from tickets t
    group by t.event_id
  ),
  cum as (
    select o.event_id, o.paid_at,
           sum(o.quantity) over (partition by o.event_id order by o.paid_at, o.id) as running
    from orders o
    where o.status = 'paid' and o.paid_at is not null
  ),
  so as (
    select c.event_id, min(c.paid_at) as sold_out_at
    from cum c
    join events e on e.id = c.event_id
    where c.running >= e.total_capacity
    group by c.event_id
  )
  select e.id, e.slug, e.name, e.status, e.starts_at, e.event_end, e.presale_start, e.sales_end,
         e.total_capacity,
         coalesce(o.preventa_sold, 0), coalesce(o.general_sold, 0), coalesce(o.free_issued, 0),
         coalesce(o.gross_cents, 0), coalesce(o.net_cents, 0),
         coalesce(o.refunded_orders, 0), coalesce(o.refunded_cents, 0),
         coalesce(t.issued_tickets, 0), coalesce(t.used_tickets, 0),
         so.sold_out_at
  from events e
  left join o  on o.event_id = e.id
  left join t  on t.event_id = e.id
  left join so on so.event_id = e.id
  where e.status <> 'draft'
  order by e.starts_at desc;
$$;

-- --- Permisos ----------------------------------------------------------------------
-- Defensa en profundidad (mismo patrón que 0017): las listas devuelven nombres;
-- que solo el service-role pueda llamarlas.
revoke execute on function report_settlement(uuid)            from public, anon, authenticated;
revoke execute on function report_settlement_lists(uuid)      from public, anon, authenticated;
revoke execute on function report_ticket_breakdown(uuid)      from public, anon, authenticated;
revoke execute on function report_checkin_slots(uuid, int)    from public, anon, authenticated;
revoke execute on function report_sales_daily(uuid)           from public, anon, authenticated;
revoke execute on function report_events_comparison()         from public, anon, authenticated;
