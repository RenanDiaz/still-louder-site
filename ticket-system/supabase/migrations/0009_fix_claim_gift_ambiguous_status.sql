-- =============================================================================
-- WWWY3 — Fix: "column reference \"status\" is ambiguous" en claim_gift()
-- =============================================================================
-- claim_gift() declara `returns table (status text, order_id uuid)`, lo que crea
-- una variable de salida llamada `status`. Dentro del UPDATE condicional sobre
-- gift_campaign, la cláusula WHERE usaba `status = 'active'` sin calificar, y
-- Postgres no podía distinguir entre la COLUMNA gift_campaign.status y la
-- VARIABLE de salida `status` -> error 42702 "column reference is ambiguous",
-- que reventaba todo reclamo de regalo.
--
-- Arreglo: calificar la columna como gift_campaign.status en el WHERE. El resto
-- de la función es idéntico a 0008 (misma lógica race-safe). El LHS del SET no
-- se puede calificar en Postgres (siempre es columna), así que queda igual.
-- =============================================================================

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
      and gift_campaign.status = 'active'
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
