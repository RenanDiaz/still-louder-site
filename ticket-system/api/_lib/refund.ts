import { getSupabase } from './supabase.js';
import { isYappyRefundConfigured, reverseYappyPayment, YappyError } from './yappy.js';
import type { Order } from './types.js';

export class RefundError extends Error {
  constructor(
    public code:
      | 'order_not_found'
      | 'order_not_paid'
      | 'no_transaction_id'
      | 'yappy_not_configured'
      | 'yappy_failed'
      | 'db_error',
    message: string,
    // For yappy_failed: Yappy's own status code/description, surfaced to the UI
    // so the admin understands why (e.g. out of the "en tránsito" window).
    public yappyCode?: string
  ) {
    super(message);
  }
}

export interface RefundResult {
  order: Order;
  via: 'yappy' | 'manual';
  voidedCount: number;
  refundRef: string | null;
}

/**
 * Refunds a paid order: reverses the money (Yappy API) when applicable, then
 * atomically marks the order refunded and voids its valid tickets via the
 * refund_order RPC. The DB step is the same regardless of payment method — the
 * money reversal is the only method-specific part — mirroring how issuance is
 * payment-agnostic.
 *
 *  - Yappy orders (opts.manual !== true): call reverseYappyPayment first; only
 *    mark refunded if it succeeds (YP-0000). On any Yappy failure we throw
 *    'yappy_failed' WITHOUT touching the DB, so the caller can offer the manual
 *    fallback (the charge may already be settled / out of the reversal window).
 *  - Cash / CuantoApp, or any order with opts.manual === true: no API call; the
 *    money is settled out-of-band and we just record the refund.
 */
export async function refundOrder(
  orderId: string,
  opts: { manual?: boolean; refundRef?: string | null; clientIp?: string } = {}
): Promise<RefundResult> {
  const supabase = getSupabase();

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle<Order>();
  if (error) throw new RefundError('db_error', error.message);
  if (!order) throw new RefundError('order_not_found', 'Order not found');
  // Only a paid order can be refunded. (refund_order is idempotent for an
  // already-refunded order, but we short-circuit here for a clearer error.)
  if (order.status !== 'paid') {
    if (order.status === 'refunded') {
      return { order, via: 'manual', voidedCount: 0, refundRef: order.refund_ref };
    }
    throw new RefundError('order_not_paid', `Order is ${order.status}, only paid orders can be refunded`);
  }

  let via: 'yappy' | 'manual' = 'manual';
  let refundRef = opts.refundRef ?? null;

  const useYappy = order.payment_method === 'yappy' && opts.manual !== true;
  if (useYappy) {
    if (!order.yappy_transaction_id) {
      throw new RefundError('no_transaction_id', 'Order has no Yappy transactionId to reverse');
    }
    if (!isYappyRefundConfigured()) {
      throw new RefundError('yappy_not_configured', 'Yappy transactional API is not configured');
    }
    try {
      await reverseYappyPayment(order.yappy_transaction_id, opts.clientIp || '0.0.0.0');
    } catch (err) {
      if (err instanceof YappyError) {
        throw new RefundError('yappy_failed', err.message, err.code);
      }
      throw err;
    }
    via = 'yappy';
    // Default the recorded ref to the reversed transaction when none was given.
    refundRef = refundRef || `yappy:${order.yappy_transaction_id}`;
  }

  const { data: refunded, error: rpcError } = await supabase
    .rpc('refund_order', { p_order_id: orderId, p_refund_ref: refundRef })
    .single<Order>();
  if (rpcError) {
    if (rpcError.message.includes('ORDER_NOT_FOUND')) {
      throw new RefundError('order_not_found', 'Order not found');
    }
    if (rpcError.message.includes('ORDER_NOT_PAID')) {
      throw new RefundError('order_not_paid', 'Order is not paid');
    }
    throw new RefundError('db_error', rpcError.message);
  }

  // Count what the RPC voided so the UI can report it ("N entradas anuladas").
  const { count, error: countError } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('status', 'void');
  if (countError) throw new RefundError('db_error', countError.message);

  return { order: refunded ?? order, via, voidedCount: count ?? 0, refundRef };
}
