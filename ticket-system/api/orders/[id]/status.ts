import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../_lib/supabase.js';
import { methodNotAllowed, sendJson, withErrorHandling } from '../../_lib/http.js';

// =============================================================================
// GET /api/orders/:id/status — public, scoped to one order
// =============================================================================
// The success page polls this until the IPN flips the order to paid (the
// browser is NOT in the confirmation loop — if the buyer refreshes mid-modal,
// polling still converges on the truth). Knowing the UUID is the capability;
// the response carries status/timestamps only, no buyer PII.
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OrderStatusRow {
  id: string;
  status: string;
  paid_at: string | null;
  reservation_expires_at: string | null;
  emailed_at: string | null;
}

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!UUID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_order_id' });

  const { data: order, error } = await getSupabase()
    .from('orders')
    .select('id, status, paid_at, reservation_expires_at, emailed_at')
    .eq('id', id)
    .maybeSingle<OrderStatusRow>();
  if (error) throw new Error(`status lookup failed: ${error.message}`);
  if (!order) return sendJson(res, 404, { error: 'order_not_found' });

  return sendJson(res, 200, {
    orderId: order.id,
    status: order.status,
    paidAt: order.paid_at,
    reservationExpiresAt: order.reservation_expires_at,
    emailed: Boolean(order.emailed_at)
  });
});
