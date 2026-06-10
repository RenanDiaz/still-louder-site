import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { methodNotAllowed, sendJson, withErrorHandling } from '../_lib/http.js';
import { issueOrder, IssueError } from '../_lib/issue.js';
import { isYappyConfigured, verifyIpnHash } from '../_lib/yappy.js';

// =============================================================================
// GET /api/yappy/ipn — Yappy's payment confirmation (the ONLY source of truth)
// =============================================================================
// Yappy calls this URL (the ipnUrl we sent in payment-wc) with query params:
//   orderId (our short order_ref), status, hash, domain, confirmationNumber.
// status: E = executed (paid) · R = rejected · C = cancelled · X = expired.
//
// The hash is HMAC-SHA256(orderId + status + domain) keyed with the first
// dot-segment of the base64-decoded secret. Nothing happens unless it
// verifies — a forged client-side eventSuccess can never mark an order paid.
//
// Issuance goes through issueOrder() like every other payment method:
// idempotent (pending->paid fires once; repeated IPNs never duplicate tickets
// or emails). Non-E statuses leave the order pending: the held cupo frees
// itself by timestamp when the reservation expires, and the buyer can retry.
// =============================================================================

function qp(req: VercelRequest, name: string): string {
  const v = req.query[name];
  return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? '') : '';
}

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!isYappyConfigured()) return sendJson(res, 503, { error: 'yappy_not_configured' });

  const orderRef = qp(req, 'orderId');
  const status = qp(req, 'status');
  const domain = qp(req, 'domain');
  const hash = qp(req, 'hash');
  const confirmationNumber = qp(req, 'confirmationNumber');

  if (!orderRef || !status || !domain || !hash) {
    return sendJson(res, 200, { success: false });
  }

  // Trust boundary: invalid hash -> acknowledge with success:false, act on nothing.
  if (!verifyIpnHash({ orderId: orderRef, status, domain, hash })) {
    console.warn('[yappy ipn] invalid hash for ref', orderRef);
    return sendJson(res, 200, { success: false });
  }

  const { data: order, error } = await getSupabase()
    .from('orders')
    .select('id, status')
    .eq('order_ref', orderRef)
    .maybeSingle<{ id: string; status: string }>();
  if (error) throw new Error(`ipn order lookup failed: ${error.message}`);
  if (!order) {
    console.warn('[yappy ipn] unknown order_ref', orderRef);
    return sendJson(res, 200, { success: false });
  }

  if (status === 'E') {
    try {
      // Same idempotent routine as the admin button: only pending->paid issues.
      await issueOrder(order.id, confirmationNumber || 'yappy');
    } catch (err) {
      if (err instanceof IssueError && err.code === 'order_cancelled') {
        // A real payment landed on an already-cancelled order (reservation
        // expired + cleanup ran before the buyer confirmed). Needs a human:
        // refund or manual issuance from the admin panel.
        console.error('[yappy ipn] payment E for CANCELLED order', order.id, confirmationNumber);
        return sendJson(res, 200, { success: false });
      }
      throw err;
    }
    return sendJson(res, 200, { success: true });
  }

  // R / C / X — no transition. The reservation keeps holding the cupo until it
  // expires by timestamp; the buyer can retry from the success page meanwhile.
  return sendJson(res, 200, { success: true });
});
