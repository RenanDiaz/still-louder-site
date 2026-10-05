-- =============================================================================
-- Analytics — atribución GA4 del `purchase` (docs/features/analytics-entradas.md)
-- =============================================================================
-- El `purchase` lo manda el servidor (Measurement Protocol) cuando la orden pasa
-- a `paid`, que puede ser días después y desde otro navegador (efectivo marcado
-- en el admin). Para que caiga en la sesión/fuente del comprador, al crear la
-- orden se guardan el client_id y session_id de GA del navegador que compró.
--
-- ga_purchase_sent_at se reclama con un UPDATE condicional (WHERE ... IS NULL)
-- antes de enviar: issueOrder() es idempotente y se llama varias veces (reintento
-- de IPN, re-marcar pagado), pero el `purchase` sale una sola vez.
--
-- Sin cambios a create_order: api/orders.ts escribe los ids con un UPDATE
-- best-effort tras el RPC. Columnas nullable: órdenes viejas, cortesías,
-- regalos y compradores con bloqueador quedan en NULL (sin `purchase`).

alter table orders
  add column if not exists ga_client_id text,
  add column if not exists ga_session_id text,
  add column if not exists ga_purchase_sent_at timestamptz;
