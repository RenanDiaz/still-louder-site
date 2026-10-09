-- =============================================================================
-- Contador de boletos configurable (docs/features/contador-boletos.md)
-- =============================================================================
-- Por evento, el admin decide si /entradas muestra "quedan N boletos" y "los
-- próximos N al precio de preventa":
--   always     siempre (comportamiento previo, default)
--   never      nunca
--   threshold  solo cuando el número es ≤ stock_display_threshold
-- El ocultamiento lo hace api/presale/status.ts (no envía el número); esta
-- migración solo guarda la preferencia. El umbral se conserva aunque el modo
-- cambie, y es obligatorio solo con 'threshold'.

alter table events
  add column if not exists stock_display text not null default 'always'
    check (stock_display in ('always', 'never', 'threshold')),
  add column if not exists stock_display_threshold int
    check (stock_display_threshold is null or stock_display_threshold >= 1);

alter table events
  drop constraint if exists events_stock_display_threshold_required,
  add constraint events_stock_display_threshold_required
    check (stock_display <> 'threshold' or stock_display_threshold is not null);
