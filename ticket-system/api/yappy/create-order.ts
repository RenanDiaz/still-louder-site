import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from '../_lib/http.js';
import {
  createYappyPaymentOrder,
  isYappyConfigured,
  RETRYABLE_YAPPY_CODES,
  validateMerchant,
  YappyError
} from '../_lib/yappy.js';
import type { Order } from '../_lib/types.js';

// =============================================================================
// POST /api/yappy/create-order — body: { orderId } (our UUID)
// =============================================================================
// Public but scoped to one order: knowing the UUID (returned only to the buyer
// who created the order) is the capability. Runs the two server-side Yappy
// calls (validate merchant -> payment-wc) and returns the trio the <btn-yappy>
// web component needs. No Yappy credential ever leaves this function.
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomOrderRef(): string {
  let ref = 'WW';
  for (let i = 0; i < 10; i++) {
    ref += REF_CHARS[crypto.randomInt(REF_CHARS.length)];
  }
  return ref;
}

/** Assign a fresh order_ref (also used when Yappy reports E007 = ref already used). */
async function assignNewOrderRef(orderId: string): Promise<string> {
  const supabase = getSupabase();
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = randomOrderRef();
    const { error } = await supabase.from('orders').update({ order_ref: ref }).eq('id', orderId);
    if (!error) return ref;
  }
  throw new Error('could_not_assign_order_ref');
}

/** Yappy wants the Panamanian number without prefix: digits only, strip 507. */
function toAliasYappy(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length > 8 && digits.startsWith('507')) digits = digits.slice(3);
  return digits.length >= 7 ? digits : null;
}

interface CreateYappyOrderBody {
  orderId?: string;
}

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!isYappyConfigured()) return sendJson(res, 501, { error: 'yappy_not_configured' });

  const body = parseBody<CreateYappyOrderBody>(req);
  const orderId = (body.orderId ?? '').trim();
  if (!UUID_RE.test(orderId)) return sendJson(res, 400, { error: 'invalid_order_id' });

  const supabase = getSupabase();
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle<Order>();
  if (error) throw new Error(`order lookup failed: ${error.message}`);
  if (!order) return sendJson(res, 404, { error: 'order_not_found' });

  if (order.status !== 'pending') {
    return sendJson(res, 409, { error: order.status === 'paid' ? 'order_already_paid' : 'order_cancelled' });
  }
  if (order.reservation_expires_at && new Date(order.reservation_expires_at) <= new Date()) {
    return sendJson(res, 409, { error: 'reservation_expired' });
  }

  // The amount is whatever the order already says (computed server-side at
  // creation); discount/taxes are always 0.00 for WWWY3 and subtotal == total.
  let orderRef = order.order_ref ?? (await assignNewOrderRef(order.id));
  const aliasYappy = toAliasYappy(order.buyer_phone);

  try {
    let session;
    try {
      const sessionToken = await validateMerchant();
      session = await createYappyPaymentOrder({
        sessionToken,
        orderRef,
        totalCents: order.total_cents,
        aliasYappy
      });
    } catch (err) {
      // E007 = "pedido ya registrado": that ref was already consumed on Yappy's
      // side (e.g. an earlier abandoned attempt). Never reuse it — mint a new
      // ref and retry once with a fresh session token.
      if (!(err instanceof YappyError) || err.code !== 'E007') throw err;
      orderRef = await assignNewOrderRef(order.id);
      const sessionToken = await validateMerchant();
      session = await createYappyPaymentOrder({
        sessionToken,
        orderRef,
        totalCents: order.total_cents,
        aliasYappy
      });
    }

    // Audit trail: keep Yappy's transactionId on the order. Best-effort — the
    // payment can proceed even if this write fails.
    const { error: txnError } = await supabase
      .from('orders')
      .update({ yappy_transaction_id: session.transactionId })
      .eq('id', order.id);
    if (txnError) console.error('[yappy] failed to store transactionId', txnError.message);

    return sendJson(res, 200, {
      transactionId: session.transactionId,
      token: session.token,
      documentName: session.documentName
    });
  } catch (err) {
    if (err instanceof YappyError) {
      console.error('[yappy] create-order failed', err.code, err.message);
      return sendJson(res, 502, {
        error: 'yappy_error',
        code: err.code,
        retryable: RETRYABLE_YAPPY_CODES.has(err.code)
      });
    }
    throw err;
  }
});
