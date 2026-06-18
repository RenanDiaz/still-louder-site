-- =============================================================================
-- WWWY3 — La Etapa 2 de preventa libera un cupo configurable
-- =============================================================================
-- Antes la Etapa 2 abría siempre 75 cupos extra (default de 0001). Ahora el
-- admin elige cuántas entradas liberar al activarla: el endpoint del toggle
-- escribe ese número en event_config.presale_stage2_cap. Bajamos el default a
-- 25 (el nuevo valor por defecto pedido) y dejamos la fila existente en 25 como
-- preset del input.
--
-- presale_status() también devuelve ahora stage2_cap para que el panel admin
-- pueda mostrar/precargar el valor. El tipo de retorno cambia, así que hay que
-- dropear y recrear (CREATE OR REPLACE no permite cambiar columnas de salida).
-- =============================================================================

alter table event_config alter column presale_stage2_cap set default 25;
update event_config set presale_stage2_cap = 25 where id = 1;

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
  stage2_cap     int,
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
  stage2_cap    := v_cfg.presale_stage2_cap;
  sold_out      := committed >= capacity;
  return next;
end;
$$;
