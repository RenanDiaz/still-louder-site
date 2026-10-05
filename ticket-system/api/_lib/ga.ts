import { getSupabase } from './supabase.js';
import { env } from './env.js';
import type { EventRow } from './events.js';
import type { Order, PaymentMethod } from './types.js';

// GA4 `purchase` via Measurement Protocol (docs/features/analytics-entradas.md).
// Server-side because payment is confirmed server-side (Yappy IPN) or by the
// admin from another browser (cash/CuantoApp): a client-side purchase would be
// wrong or never fire. Called from issueOrder(), so every payment path counts.
//
// Best-effort by design: the caller wraps it in try/catch, the request times
// out fast and there is no retry. Analytics must never block issuance.

const MP_URL = 'https://www.google-analytics.com/mp/collect';
const TIMEOUT_MS = 2000;
// Courtesy and gift orders are $0 and never go through the purchase funnel.
const COUNTED_METHODS: PaymentMethod[] = ['yappy', 'cuantoapp', 'cash'];

// Formats written by gtag ("<random>.<timestamp>" and a unix-seconds session).
// Anything else from the client is dropped, never stored.
export const GA_CLIENT_ID_RE = /^\d{1,12}\.\d{1,12}$/;
export const GA_SESSION_ID_RE = /^\d{1,20}$/;

export async function sendPurchase(order: Order, event: EventRow): Promise<void> {
  const apiSecret = env.gaMpApiSecret;
  if (!apiSecret || !order.ga_client_id || order.ga_purchase_sent_at) return;
  if (order.status !== 'paid' || !COUNTED_METHODS.includes(order.payment_method)) return;

  // Claim first (atomic, like validate_ticket): of concurrent/repeated
  // issueOrder() calls, only the one whose UPDATE matches sends the event.
  const { data: claimed, error } = await getSupabase()
    .from('orders')
    .update({ ga_purchase_sent_at: new Date().toISOString() })
    .eq('id', order.id)
    .is('ga_purchase_sent_at', null)
    .select('id');
  if (error) throw new Error(`ga claim failed: ${error.message}`);
  if (!claimed || claimed.length === 0) return;

  // No PII: transaction_id is our order UUID, meaningless outside our DB.
  const params: Record<string, unknown> = {
    transaction_id: order.id,
    value: order.total_cents / 100,
    currency: 'USD',
    payment_type: order.payment_method,
    event_slug: event.slug,
    // Without it GA4 does not tie the event to the session.
    engagement_time_msec: 1,
    items: [
      {
        item_id: `${event.slug}-${order.tier}`,
        item_name: `${event.short_name} — ${order.tier}`,
        item_category: order.tier,
        price: order.total_cents / 100 / order.quantity,
        quantity: order.quantity
      }
    ]
  };
  if (order.ga_session_id) params.session_id = order.ga_session_id;

  const qs = new URLSearchParams({ measurement_id: env.gaMeasurementId, api_secret: apiSecret });
  const res = await fetch(`${MP_URL}?${qs}`, {
    method: 'POST',
    body: JSON.stringify({ client_id: order.ga_client_id, events: [{ name: 'purchase', params }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`ga mp responded ${res.status}`);
}
