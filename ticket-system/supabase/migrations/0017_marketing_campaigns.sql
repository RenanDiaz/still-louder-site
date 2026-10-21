-- =============================================================================
-- Campañas de promoción — Fase 1: contactos, campañas y envío por olas
-- (docs/features/campanas-promocion.md)
-- =============================================================================
-- Contactos derivados de las órdenes pagadas (D3), campañas escritas a mano y
-- un snapshot de destinatarios por campaña que se envía en olas manuales
-- (D10). Nada aquí toca el flujo transaccional: issue.ts y sendTicketEmail no
-- leen estas tablas, así que una baja nunca bloquea un QR (D6).
--
-- Garantías que viven en la base, no en el cliente:
--   - sync_marketing_contacts() nunca reescribe tags ni revierte una baja,
--     salvo que el contacto vuelva a marcar la casilla de Fase 0 DESPUÉS de
--     darse de baja. bounced/complained nunca se revierten.
--   - freeze_campaign() aplica D12: sin audience.include_legacy, un
--     legacy_buyer sin la etiqueta 'allegado' no entra en la campaña.
--   - claim_wave() serializa con FOR UPDATE sobre la campaña (mismo patrón que
--     create_order/claim_gift) y pasa cada destinatario queued -> sending con
--     un UPDATE condicional: cada (campaign_id, email) se reclama una sola vez,
--     aunque lleguen dos "Enviar siguiente ola" a la vez. Antes de reclamar
--     vuelve a comprobar bajas y el tope de frecuencia.
--
-- Funciones auxiliares (las usa api/_lib/marketing.ts para no hacer una
-- llamada por contacto — el Worker tiene un tope de subrequests):
-- marketing_audience, marketing_contact_events, tag_marketing_contacts,
-- record_marketing_results, marketing_campaign_stats.
--
-- Todas las tablas con RLS habilitado y sin policies (solo service-role), y las
-- funciones sin EXECUTE para anon/authenticated (devuelven PII).
-- =============================================================================

-- --- Contactos -----------------------------------------------------------------
create table if not exists marketing_contact (
  email            text primary key
                     check (email = lower(btrim(email)) and email <> ''),
  name             text,                       -- último buyer_name visto
  consent_source   text not null default 'legacy_buyer'
                     check (consent_source in ('legacy_buyer', 'checkout_opt_in')),
  status           text not null default 'subscribed'
                     check (status in ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  tags             text[] not null default '{}',   -- p. ej. {'allegado'}; minúsculas
  first_order_at   timestamptz,
  last_order_at    timestamptz,
  last_campaign_at timestamptz,                -- tope de frecuencia (D7)
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists marketing_contact_tags_idx on marketing_contact using gin (tags);

-- --- Campañas ------------------------------------------------------------------
-- audience: {kind:'all'|'tags'|'events'|'manual', tags?, event_ids?,
--            exclude_event_ids?, emails?, include_legacy?}
--   kind 'all' = todos los contactos; cualquier otro kind = la UNIÓN de los
--   tags / event_ids / emails que traiga (el kind solo dice qué eligió la UI).
--   exclude_event_ids y include_legacy aplican a todos los kinds.
create table if not exists marketing_campaign (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique
                       check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  subject            text not null check (char_length(subject) between 1 and 120),
  preheader          text not null default '' check (char_length(preheader) <= 140),
  body_md            text not null default '' check (char_length(body_md) <= 20000),
  image_url          text check (image_url is null or image_url ~ '^https://'),
  cta_label          text check (cta_label is null or char_length(cta_label) between 1 and 40),
  cta_url            text check (cta_url is null or cta_url ~ '^https://'),
  audience           jsonb not null default '{"kind":"all"}'::jsonb
                       check (jsonb_typeof(audience) = 'object'
                              and audience->>'kind' in ('all', 'tags', 'events', 'manual')),
  delivery           text not null default 'immediate'
                       check (delivery in ('immediate', 'waves')),
  wave_size          int check (wave_size is null or wave_size > 0),
  status             text not null default 'draft'
                       check (status in ('draft', 'ready', 'sending', 'paused', 'completed', 'cancelled')),
  -- Gate de congelado: la prueba debe ser posterior al último cambio de
  -- CONTENIDO (asunto, preheader, cuerpo, imagen, CTA). Cambiar solo la
  -- audiencia no cambia el correo, así que no exige otra prueba.
  test_sent_at       timestamptz,
  content_updated_at timestamptz not null default now(),
  frozen_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (delivery <> 'waves' or wave_size is not null),
  check ((cta_label is null) = (cta_url is null))
);

-- --- Destinatarios (snapshot de la audiencia al congelar) ------------------------
create table if not exists marketing_recipient (
  campaign_id uuid not null references marketing_campaign(id) on delete cascade,
  email       text not null references marketing_contact(email),
  position    int  not null,                   -- orden de envío
  wave        int,                             -- se asigna al reclamar
  status      text not null default 'queued'
                check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  -- 'cancelled' = la campaña se canceló con el destinatario aún en cola.
  skip_reason text check (skip_reason in ('unsubscribed', 'bounced', 'complained', 'frequency_cap', 'cancelled')),
  resend_id   text,
  error       text,
  claimed_at  timestamptz,                     -- queued -> sending (huérfanos > 10 min)
  sent_at     timestamptz,
  primary key (campaign_id, email),
  check ((status = 'skipped') = (skip_reason is not null))
);

create index if not exists marketing_recipient_queue_idx
  on marketing_recipient (campaign_id, status, position);
create index if not exists marketing_recipient_email_idx
  on marketing_recipient (email);

alter table marketing_contact   enable row level security;
alter table marketing_campaign  enable row level security;
alter table marketing_recipient enable row level security;

-- --- Poblado de contactos ------------------------------------------------------
-- Idempotente. Solo órdenes 'paid' (D3: incluye cortesías y regalos; pending,
-- cancelled y refunded no generan contacto). Devuelve el total de contactos.
create or replace function sync_marketing_contacts()
returns int
language plpgsql
as $$
declare
  v_total int;
begin
  with paid as (
    select lower(btrim(o.buyer_email)) as email,
           o.buyer_name, o.created_at, o.marketing_opt_in
    from orders o
    where o.status = 'paid' and btrim(o.buyer_email) <> ''
  ),
  agg as (
    select p.email,
           (array_agg(p.buyer_name order by p.created_at desc))[1] as name,
           case when bool_or(p.marketing_opt_in) then 'checkout_opt_in' else 'legacy_buyer' end as consent_source,
           min(p.created_at) as first_order_at,
           max(p.created_at) as last_order_at
    from paid p
    group by p.email
  )
  insert into marketing_contact as mc (email, name, consent_source, first_order_at, last_order_at)
  select a.email, a.name, a.consent_source, a.first_order_at, a.last_order_at
  from agg a
  on conflict (email) do update
    set name           = excluded.name,
        first_order_at = least(mc.first_order_at, excluded.first_order_at),
        last_order_at  = greatest(mc.last_order_at, excluded.last_order_at),
        -- Solo sube legacy_buyer -> checkout_opt_in; nunca baja.
        consent_source = case when excluded.consent_source = 'checkout_opt_in'
                              then 'checkout_opt_in' else mc.consent_source end
    -- tags y status NUNCA se tocan aquí.
    where mc.name is distinct from excluded.name
       or mc.first_order_at is distinct from least(mc.first_order_at, excluded.first_order_at)
       or mc.last_order_at is distinct from greatest(mc.last_order_at, excluded.last_order_at)
       or (excluded.consent_source = 'checkout_opt_in' and mc.consent_source <> 'checkout_opt_in');

  -- Única reversión automática de una baja: volvió a marcar la casilla DESPUÉS
  -- de darse de baja. Comprar de nuevo sin marcarla no revierte nada.
  update marketing_contact mc
    set status = 'subscribed',
        unsubscribed_at = null,
        consent_source = 'checkout_opt_in'
  where mc.status = 'unsubscribed'
    and exists (
      select 1 from orders o
      where o.status = 'paid'
        and o.marketing_opt_in
        and lower(btrim(o.buyer_email)) = mc.email
        and o.marketing_opt_in_at > coalesce(mc.unsubscribed_at, '-infinity'::timestamptz)
    );

  select count(*) into v_total from marketing_contact;
  return v_total;
end;
$$;

-- --- Eventos de cada contacto (órdenes pagadas) ----------------------------------
create or replace function marketing_contact_events()
returns table (email text, event_ids uuid[])
language sql
stable
as $$
  select lower(btrim(o.buyer_email)) as email, array_agg(distinct o.event_id) as event_ids
  from orders o
  where o.status = 'paid' and btrim(o.buyer_email) <> ''
  group by lower(btrim(o.buyer_email));
$$;

-- --- Audiencia ------------------------------------------------------------------
-- Cada contacto que cumple `audience`, con el resultado que tendría HOY:
--   eligible | frequency_cap | no_consent (D12) | unsubscribed | bounced | complained
-- La usan la vista previa (conteos) y freeze_campaign (snapshot), así que D12
-- se aplica en un solo lugar.
create or replace function marketing_audience(p_audience jsonb, p_frequency_days int default 14)
returns table (email text, outcome text)
language plpgsql
stable
as $$
#variable_conflict use_column
declare
  v_kind           text    := coalesce(p_audience->>'kind', 'all');
  v_tags           text[]  := array(select jsonb_array_elements_text(coalesce(p_audience->'tags', '[]'::jsonb)));
  v_emails         text[]  := array(select lower(btrim(x))
                                    from jsonb_array_elements_text(coalesce(p_audience->'emails', '[]'::jsonb)) x);
  v_event_ids      uuid[]  := array(select x::uuid
                                    from jsonb_array_elements_text(coalesce(p_audience->'event_ids', '[]'::jsonb)) x);
  v_exclude        uuid[]  := array(select x::uuid
                                    from jsonb_array_elements_text(coalesce(p_audience->'exclude_event_ids', '[]'::jsonb)) x);
  v_include_legacy boolean := coalesce((p_audience->>'include_legacy')::boolean, false);
begin
  return query
  with paid as (
    select lower(btrim(o.buyer_email)) as email, o.event_id
    from orders o
    where o.status = 'paid'
  )
  select c.email,
         case
           when c.status <> 'subscribed' then c.status
           when not (v_include_legacy
                     or c.consent_source = 'checkout_opt_in'
                     or 'allegado' = any(c.tags)) then 'no_consent'
           when c.last_campaign_at > now() - make_interval(days => p_frequency_days) then 'frequency_cap'
           else 'eligible'
         end
  from marketing_contact c
  where (
          v_kind = 'all'
          or c.tags && v_tags
          or c.email = any(v_emails)
          or exists (select 1 from paid p where p.email = c.email and p.event_id = any(v_event_ids))
        )
    and not exists (select 1 from paid p where p.email = c.email and p.event_id = any(v_exclude));
end;
$$;

-- --- Etiquetado masivo -----------------------------------------------------------
create or replace function tag_marketing_contacts(p_emails text[], p_add text[], p_remove text[])
returns int
language sql
as $$
  with updated as (
    update marketing_contact c
      set tags = array(
        select distinct t
        from unnest(c.tags || coalesce(p_add, '{}')) t
        where t <> all(coalesce(p_remove, '{}'))
        order by t
      )
    where c.email = any(p_emails)
    returning 1
  )
  select count(*)::int from updated;
$$;

-- --- Congelar la audiencia --------------------------------------------------------
-- Devuelve status:
--   'not_found' | 'not_draft' | 'test_required' (sin prueba o el contenido
--   cambió después) | 'empty_audience' | 'frozen' (recipients = destinatarios)
-- Entran los contactos subscribed que cumplen audience + D12. Los que hoy
-- están dentro del tope de frecuencia también entran: claim_wave los omite si
-- siguen dentro cuando les toque su ola.
create or replace function freeze_campaign(p_campaign_id uuid, p_frequency_days int default 14)
returns table (status text, recipients int)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_campaign marketing_campaign;
  v_count    int;
begin
  select * into v_campaign from marketing_campaign where id = p_campaign_id for update;

  if v_campaign.id is null then
    status := 'not_found';
    return next;
    return;
  end if;
  if v_campaign.status <> 'draft' then
    status := 'not_draft';
    return next;
    return;
  end if;
  if v_campaign.test_sent_at is null or v_campaign.test_sent_at < v_campaign.content_updated_at then
    status := 'test_required';
    return next;
    return;
  end if;

  insert into marketing_recipient (campaign_id, email, position)
  select p_campaign_id, a.email,
         row_number() over (
           order by
             -- Escalonado: primero la muestra ('allegado'), luego el resto al
             -- azar (fijado aquí). Inmediato: alfabético (una sola tanda).
             case when v_campaign.delivery = 'waves' and 'allegado' = any(c.tags) then 0 else 1 end,
             case when v_campaign.delivery = 'waves' then random() else 0 end,
             c.email
         )
  from marketing_audience(v_campaign.audience, p_frequency_days) a
  join marketing_contact c on c.email = a.email
  where a.outcome in ('eligible', 'frequency_cap');

  get diagnostics v_count = row_count;
  if v_count = 0 then
    status := 'empty_audience';
    return next;
    return;
  end if;

  update marketing_campaign
    set status = 'ready', frozen_at = now(), updated_at = now()
  where id = p_campaign_id;

  status := 'frozen';
  recipients := v_count;
  return next;
end;
$$;

-- --- Reclamar una ola -------------------------------------------------------------
-- Atómico (patrón de create_order/claim_gift): FOR UPDATE sobre la campaña
-- serializa dos "Enviar siguiente ola" simultáneos. Recorre los queued por
-- position hasta juntar p_size enviables; en el camino marca skipped a los que
-- se dieron de baja / rebotaron / se quejaron o están dentro del tope de
-- frecuencia. Los enviables pasan a 'sending' con un UPDATE condicional
-- (status = 'queued') y se devuelven. Todos los tocados llevan el mismo número
-- de ola (max(wave) + 1).
-- Devuelve cero filas si la campaña no existe, no está en ready/sending, o no
-- quedan enviables.
create or replace function claim_wave(p_campaign_id uuid, p_size int, p_frequency_days int default 14)
returns table (recipient_email text, recipient_name text, recipient_consent text, wave_no int)
language plpgsql
as $$
declare
  v_campaign marketing_campaign;
  v_wave     int;
  v_taken    int := 0;
  v_touched  int := 0;
  r          record;
begin
  if p_size is null or p_size < 1 or p_size > 1000 then
    raise exception 'claim_wave: invalid size %', p_size;
  end if;

  select * into v_campaign from marketing_campaign where id = p_campaign_id for update;
  if v_campaign.id is null or v_campaign.status not in ('ready', 'sending') then
    return;
  end if;

  select coalesce(max(mr.wave), 0) + 1 into v_wave
  from marketing_recipient mr where mr.campaign_id = p_campaign_id;

  for r in
    select mr.email, c.status as contact_status, c.last_campaign_at, c.name, c.consent_source
    from marketing_recipient mr
    join marketing_contact c on c.email = mr.email
    where mr.campaign_id = p_campaign_id and mr.status = 'queued'
    order by mr.position
  loop
    exit when v_taken >= p_size;

    if r.contact_status <> 'subscribed' then
      update marketing_recipient mr
        set status = 'skipped', skip_reason = r.contact_status, wave = v_wave
      where mr.campaign_id = p_campaign_id and mr.email = r.email and mr.status = 'queued';
      v_touched := v_touched + 1;
    elsif r.last_campaign_at > now() - make_interval(days => p_frequency_days) then
      update marketing_recipient mr
        set status = 'skipped', skip_reason = 'frequency_cap', wave = v_wave
      where mr.campaign_id = p_campaign_id and mr.email = r.email and mr.status = 'queued';
      v_touched := v_touched + 1;
    else
      update marketing_recipient mr
        set status = 'sending', wave = v_wave, claimed_at = now()
      where mr.campaign_id = p_campaign_id and mr.email = r.email and mr.status = 'queued';
      if found then
        v_taken := v_taken + 1;
        v_touched := v_touched + 1;
        recipient_email   := r.email;
        recipient_name    := r.name;
        recipient_consent := r.consent_source;
        wave_no           := v_wave;
        return next;
      end if;
    end if;
  end loop;

  if v_touched > 0 and v_campaign.status = 'ready' then
    update marketing_campaign set status = 'sending', updated_at = now() where id = p_campaign_id;
  end if;
end;
$$;

-- --- Registrar el resultado de un lote --------------------------------------------
-- p_results: [{email, resend_id?, error?}] — con resend_id = sent (y el contacto
-- queda con last_campaign_at = now()), si no = failed. Solo toca filas que
-- siguen en 'sending', así que repetirlo no cambia nada.
create or replace function record_marketing_results(p_campaign_id uuid, p_results jsonb)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  with res as (
    select lower(btrim(x->>'email')) as email,
           nullif(x->>'resend_id', '') as resend_id,
           left(nullif(x->>'error', ''), 500) as error
    from jsonb_array_elements(p_results) x
  ),
  upd as (
    update marketing_recipient mr
      set status  = case when res.resend_id is not null then 'sent' else 'failed' end,
          resend_id = res.resend_id,
          error   = case when res.resend_id is null then coalesce(res.error, 'unknown_error') end,
          sent_at = case when res.resend_id is not null then now() end
    from res
    where mr.campaign_id = p_campaign_id and mr.email = res.email and mr.status = 'sending'
    returning mr.email, mr.status
  ),
  touch as (
    update marketing_contact c
      set last_campaign_at = now()
    from upd
    where c.email = upd.email and upd.status = 'sent'
    returning 1
  )
  select count(*)::int into v_count from upd;
  return v_count;
end;
$$;

-- --- Métricas por campaña y por ola ------------------------------------------------
-- Una fila por (campaña, ola); wave null = aún en cola (sin ola). `unsubscribed`
-- = bajas atribuidas: destinatarios 'sent' que hoy están de baja con
-- unsubscribed_at posterior al envío (el token de baja no lleva campaña; el
-- tope de frecuencia hace que la última campaña recibida sea casi siempre la
-- responsable).
create or replace function marketing_campaign_stats(p_campaign_id uuid default null)
returns table (
  campaign_id uuid, wave int, queued int, sending int, sent int, failed int,
  skipped_unsubscribed int, skipped_bounced int, skipped_complained int,
  skipped_frequency_cap int, skipped_cancelled int, unsubscribed int,
  first_sent_at timestamptz
)
language sql
stable
as $$
  select mr.campaign_id, mr.wave,
         count(*) filter (where mr.status = 'queued')::int,
         count(*) filter (where mr.status = 'sending')::int,
         count(*) filter (where mr.status = 'sent')::int,
         count(*) filter (where mr.status = 'failed')::int,
         count(*) filter (where mr.skip_reason = 'unsubscribed')::int,
         count(*) filter (where mr.skip_reason = 'bounced')::int,
         count(*) filter (where mr.skip_reason = 'complained')::int,
         count(*) filter (where mr.skip_reason = 'frequency_cap')::int,
         count(*) filter (where mr.skip_reason = 'cancelled')::int,
         count(*) filter (where mr.status = 'sent' and c.status = 'unsubscribed'
                          and c.unsubscribed_at >= mr.sent_at)::int,
         min(mr.sent_at)
  from marketing_recipient mr
  join marketing_contact c on c.email = mr.email
  where p_campaign_id is null or mr.campaign_id = p_campaign_id
  group by mr.campaign_id, mr.wave;
$$;

-- --- Permisos ----------------------------------------------------------------------
-- Defensa en profundidad: con RLS sin policies anon ya no vería filas, pero
-- estas funciones devuelven correos; que solo el service-role pueda llamarlas.
revoke execute on function sync_marketing_contacts()                       from public, anon, authenticated;
revoke execute on function marketing_contact_events()                      from public, anon, authenticated;
revoke execute on function marketing_audience(jsonb, int)                  from public, anon, authenticated;
revoke execute on function tag_marketing_contacts(text[], text[], text[])  from public, anon, authenticated;
revoke execute on function freeze_campaign(uuid, int)                      from public, anon, authenticated;
revoke execute on function claim_wave(uuid, int, int)                      from public, anon, authenticated;
revoke execute on function record_marketing_results(uuid, jsonb)           from public, anon, authenticated;
revoke execute on function marketing_campaign_stats(uuid)                  from public, anon, authenticated;
grant execute on function sync_marketing_contacts()                        to service_role;
grant execute on function marketing_contact_events()                       to service_role;
grant execute on function marketing_audience(jsonb, int)                   to service_role;
grant execute on function tag_marketing_contacts(text[], text[], text[])   to service_role;
grant execute on function freeze_campaign(uuid, int)                       to service_role;
grant execute on function claim_wave(uuid, int, int)                       to service_role;
grant execute on function record_marketing_results(uuid, jsonb)            to service_role;
grant execute on function marketing_campaign_stats(uuid)                   to service_role;
