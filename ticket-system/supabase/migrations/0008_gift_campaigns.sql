-- =============================================================================
-- WWWY3 — Campañas de entradas de regalo vía QR oculto
-- =============================================================================
-- Un admin crea una "campaña de regalo" con un cupo N (max_gifts) y obtiene un
-- token aleatorio largo. El token vive en una URL oculta (/regalo/<token>) que
-- solo se alcanza escaneando el QR generado en el panel. Las primeras N personas
-- que completen el formulario reciben una entrada de tipo nuevo: 'regalo'.
--
-- 'regalo' es DISTINTO de 'cortesia' a propósito (reportes/auditoría): es un
-- tier propio con su método de pago 'gift'. Reutiliza el mismo pipeline de
-- emisión que todo lo demás (orden $0 pending -> issueOrder -> QR firmado +
-- email Resend), igual que la cortesía.
--
-- Cupo: el regalo tiene su PROPIO cupo por campaña (max_gifts) y NO cuenta
-- contra el cupo de preventa. presale_status() y create_order() solo agregan
-- tier in ('preventa','cortesia'), así que 'regalo' queda fuera sin tocarlas.
--
-- Race-safety: claim_gift() reserva el cupo con un UPDATE condicional atómico
-- bajo FOR UPDATE sobre la fila de la campaña — mismo nivel de cuidado que
-- create_order()/validate_ticket(). Jamás se entrega N+1.
-- =============================================================================

-- --- Nuevo tier 'regalo' y método de pago 'gift' -----------------------------
alter table orders drop constraint if exists orders_tier_check;
alter table orders add constraint orders_tier_check
  check (tier in ('preventa', 'general', 'cortesia', 'regalo'));

alter table orders drop constraint if exists orders_payment_method_check;
alter table orders add constraint orders_payment_method_check
  check (payment_method in ('yappy', 'cuantoapp', 'cash', 'courtesy', 'gift'));

alter table tickets drop constraint if exists tickets_tier_check;
alter table tickets add constraint tickets_tier_check
  check (tier in ('preventa', 'general', 'cortesia', 'regalo'));

-- --- Campañas de regalo -------------------------------------------------------
create table if not exists gift_campaign (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,          -- aleatorio, largo, no secuencial
  max_gifts     int  not null check (max_gifts > 0),
  claimed_count int  not null default 0,
  status        text not null default 'active'
                  check (status in ('active', 'exhausted', 'closed')),
  created_at    timestamptz not null default now()
);

create table if not exists gift_claim (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references gift_campaign(id) on delete cascade,
  name        text not null,
  email       text not null,
  phone       text,
  -- La entrada emitida vive como una orden $0 'regalo' (1 entrada). Si la orden
  -- se borrara, conservamos el reclamo como registro de auditoría.
  order_id    uuid references orders(id) on delete set null,
  claimer_ip  text,                            -- auditoría + throttle suave
  created_at  timestamptz not null default now()
);

-- Un reclamo por email por campaña (case-insensitive). El índice único es la red
-- de seguridad; claim_gift() también lo verifica explícitamente para devolver un
-- mensaje amable sin consumir cupo.
create unique index if not exists gift_claim_email_uq
  on gift_claim (campaign_id, lower(email));
create index if not exists gift_claim_campaign_idx
  on gift_claim (campaign_id, created_at desc);
-- Apoya el throttle suave por IP del endpoint público.
create index if not exists gift_claim_ip_idx
  on gift_claim (claimer_ip, created_at desc);

-- Solo el service-role accede (RLS habilitado, sin policies — igual que el resto).
alter table gift_campaign enable row level security;
alter table gift_claim    enable row level security;

-- --- RPC atómico: reclamar una entrada de regalo ------------------------------
-- Serializa los reclamos concurrentes de UNA campaña con FOR UPDATE sobre su
-- fila, y reserva el cupo con un UPDATE condicional (status='active' AND
-- claimed_count < max_gifts). Solo si esa reserva afecta una fila se crea la
-- orden $0 'regalo' (en 'pending'); Node la marca pagada y emite vía issueOrder.
-- Al llegar a N la campaña pasa a 'exhausted' en el mismo UPDATE.
--
-- Devuelve status:
--   'not_found'       token inexistente (respuesta neutra al público)
--   'closed'          cerrada manualmente
--   'exhausted'       ya no quedan entradas (#N+1 en adelante)
--   'already_claimed' ese email ya reclamó en esta campaña (no consume cupo)
--   'claimed'         éxito; order_id es la orden $0 lista para emitir
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
  v_order    orders;
begin
  select * into v_campaign from gift_campaign where token = p_token for update;

  if v_campaign.id is null then
    status := 'not_found';
    return next;
    return;
  end if;

  if v_campaign.status <> 'active' then
    status := v_campaign.status;  -- 'exhausted' | 'closed'
    return next;
    return;
  end if;

  -- Email duplicado: no consume cupo.
  if exists (
    select 1 from gift_claim
    where campaign_id = v_campaign.id and lower(email) = lower(p_email)
  ) then
    status := 'already_claimed';
    return next;
    return;
  end if;

  -- Reserva atómica del cupo + auto-cierre al llegar a N.
  update gift_campaign
    set claimed_count = claimed_count + 1,
        status = case
                   when claimed_count + 1 >= max_gifts then 'exhausted'
                   else 'active'
                 end
    where id = v_campaign.id
      and status = 'active'
      and claimed_count < max_gifts
    returning * into v_campaign;

  if not found then
    -- Otro reclamo concurrente tomó el último cupo entre el SELECT y el UPDATE.
    status := 'exhausted';
    return next;
    return;
  end if;

  -- Orden $0 'regalo' en 'pending'; issueOrder (Node) la marca paid y emite.
  insert into orders (
    buyer_name, buyer_email, buyer_phone, tier, quantity,
    total_cents, net_cents, fee_cents, payment_method, status
  )
  values (
    p_name, p_email, p_phone, 'regalo', 1,
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
