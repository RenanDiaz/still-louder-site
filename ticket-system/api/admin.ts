import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from './_lib/supabase.js';
import { isAdmin, isCron, isSupport } from './_lib/auth.js';
import { methodNotAllowed, parseBody, sendHtml, sendJson, withErrorHandling } from './_lib/http.js';
import { issueOrder, resendOrderEmail, IssueError } from './_lib/issue.js';
import { refundOrder, RefundError } from './_lib/refund.js';
import { buildRefundReceiptHtml } from './_lib/receipt.js';
import { MAX_QUANTITY_PER_ORDER } from './_lib/pricing.js';
import { ensureEventTicketClass, isGoogleWalletConfigured } from './_lib/google-wallet.js';
import { tokenToDataUrl } from './_lib/qr.js';
import { env } from './_lib/env.js';
import {
  EVENT_CODE_RE,
  EVENT_SLUG_RE,
  canTransition,
  getEventById,
  getTierPrices,
  type EventRow,
  type EventStatus
} from './_lib/events.js';
import { randomBytes } from 'node:crypto';
import type { GiftCampaign, GiftClaim, Order, PresaleStatus, Ticket } from './_lib/types.js';

// Single function for EVERY /api/admin/* route. Vercel Hobby caps a deployment
// at 12 serverless functions, so all admin endpoints share one function instead
// of one file each. Catch-all filenames ([...path].ts) only work in Next.js —
// in a plain api/ directory they deploy but never match, so requests 404. This
// file therefore lives at the fixed path /api/admin and a rewrite in
// vercel.json maps /api/admin/:path* onto it, passing the sub-path in the
// `path` query param:
//
// Every route that reads or changes per-event data takes `?event=<event id>`
// and is scoped to it; without it → 400 event_required (never "all events" by
// accident). Routes that act on ONE order/ticket/campaign by id don't need it.
// GET orders without ?event= is the support search: it spans every event.
//
//   GET  /api/admin/events                     events + summary metrics
//   POST /api/admin/events                     create an event (starts as draft)
//   PATCH /api/admin/events/:id                edit fields + tier prices
//   POST /api/admin/events/:id/status          status transition { status }
//   GET  /api/admin/orders?event=&q=&status=   order list + sales stats
//   POST /api/admin/orders/cleanup             cancel expired pendings (also GET, cron)
//   POST /api/admin/orders/:id/mark-paid       mark paid -> issue tickets + email
//   POST /api/admin/orders/:id/cancel          cancel a specific pending order
//   POST /api/admin/orders/:id/refund          paid -> refunded (Yappy reversal + void tickets)
//   GET  /api/admin/orders/:id/refund-receipt  printable refund receipt (HTML) for a refunded order
//   POST /api/admin/orders/:id/resend-email    re-send the QR email for a paid order
//   POST /api/admin/presale/stage2             toggle the second presale stage
//   GET  /api/admin/tickets?q=&status=&tier=   ticket list + usage stats
//   POST /api/admin/tickets/:id/revoke         valid -> void (gate will reject it)
//   POST /api/admin/tickets/:id/unrevoke       void -> valid
//   POST /api/admin/courtesy                   create + issue a courtesy order ($0)
//   GET  /api/admin/gifts                       list gift campaigns + metrics
//   POST /api/admin/gifts                       create a gift campaign (token + QR)
//   GET  /api/admin/gifts/:id                   campaign detail + claims list + QR
//   POST /api/admin/gifts/:id/close             close an active campaign early
//   GET  /api/admin/orders/:id              one order + its tickets (support)
//   POST /api/admin/wallet/google/ensure-class create the Google Wallet event class (idempotent)
//
// Everything is admin-gated except:
//   - orders/cleanup, which also accepts the cron secret (daily Vercel Cron, GET);
//   - the read-only customer-support routes (GET orders search, GET orders/:id,
//     POST orders/:id/resend-email), which also accept SUPPORT_PASSWORD via
//     isSupport(). Support never reaches the mutating routes (mark-paid, cancel,
//     revoke, courtesy, stage2) nor the sales/revenue stats.

const ORDER_STATUSES = ['pending', 'paid', 'cancelled'];
const TICKET_STATUSES = ['valid', 'used', 'void'];
const TICKET_TIERS = ['preventa', 'general', 'cortesia', 'regalo'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads ?event=<id> and loads the event, answering 400/404 itself when it
// can't. Callers return early on null.
async function requireEvent(req: VercelRequest, res: VercelResponse): Promise<EventRow | null> {
  const raw = req.query.event;
  const id = (Array.isArray(raw) ? raw[0] : raw ?? '').trim();
  if (!id) {
    sendJson(res, 400, { error: 'event_required' });
    return null;
  }
  const event = await getEventById(id);
  if (!event) {
    sendJson(res, 404, { error: 'event_not_found' });
    return null;
  }
  return event;
}

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  // The rewrite delivers the sub-path slash-joined in `path`
  // (e.g. "orders/<id>/mark-paid"); split it back into segments.
  const raw = req.query.path;
  const joined = Array.isArray(raw) ? raw.join('/') : typeof raw === 'string' ? raw : '';
  const segments = joined.split('/').filter(Boolean);
  const route = segments.join('/');

  const admin = isAdmin(req);

  // cleanup is the only route the cron may call; everything else is gated below.
  if (route === 'orders/cleanup') {
    if (!admin && !isCron(req)) return sendJson(res, 401, { error: 'unauthorized' });
    return cleanupOrders(req, res);
  }

  // --- Customer-support routes (read-only lookup + resend email) -------------
  // Reachable by SUPPORT_PASSWORD or ADMIN_PASSWORD (isSupport covers both).
  // Listed BEFORE the admin gate so support can reach them; passing `admin`
  // into listOrders is what unlocks the full table + sales stats for admins.
  if (route === 'orders' && req.method === 'GET') {
    if (!isSupport(req)) return sendJson(res, 401, { error: 'unauthorized' });
    // With ?event= (admin panel): that event's list + its stats, admin only.
    // Without it (/support, with the support OR the admin password): the
    // cross-event search, which requires a search term and returns no stats.
    if (!admin || !req.query.event) return listOrders(req, res, null);
    const event = await requireEvent(req, res);
    if (!event) return;
    return listOrders(req, res, event);
  }
  if (segments[0] === 'orders' && segments.length === 2 && req.method === 'GET') {
    // GET orders/:id — one order + its tickets (orders/cleanup handled above).
    if (!isSupport(req)) return sendJson(res, 401, { error: 'unauthorized' });
    return getOrderDetail(res, segments[1]);
  }
  if (segments[0] === 'orders' && segments.length === 3 && segments[2] === 'resend-email') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (!isSupport(req)) return sendJson(res, 401, { error: 'unauthorized' });
    return resendEmail(res, segments[1]);
  }

  // --- Everything below is admin-only ----------------------------------------
  if (!admin) return sendJson(res, 401, { error: 'unauthorized' });

  if (segments[0] === 'orders' && segments.length === 3 && segments[2] === 'refund-receipt') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return refundReceipt(res, segments[1]);
  }
  if (segments[0] === 'orders' && segments.length === 3) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const [, id, action] = segments;
    if (action === 'mark-paid') return markOrderPaid(req, res, id);
    if (action === 'cancel') return cancelOrder(res, id);
    if (action === 'refund') return refund(req, res, id);
  }
  if (route === 'events') {
    if (req.method === 'GET') return listEvents(res);
    if (req.method === 'POST') return createEvent(req, res);
    return methodNotAllowed(res, ['GET', 'POST']);
  }
  if (segments[0] === 'events' && segments.length === 2) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);
    return updateEvent(req, res, segments[1]);
  }
  if (segments[0] === 'events' && segments.length === 3 && segments[2] === 'status') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return setEventStatus(req, res, segments[1]);
  }
  if (route === 'presale/stage2') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const event = await requireEvent(req, res);
    if (!event) return;
    return toggleStage2(req, res, event);
  }
  if (route === 'tickets') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const event = await requireEvent(req, res);
    if (!event) return;
    return listTickets(req, res, event);
  }
  if (segments[0] === 'tickets' && segments.length === 3) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const [, id, action] = segments;
    if (action === 'revoke') return setTicketStatus(res, id, 'void');
    if (action === 'unrevoke') return setTicketStatus(res, id, 'valid');
  }
  if (route === 'courtesy') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const event = await requireEvent(req, res);
    if (!event) return;
    return createCourtesy(req, res, event);
  }
  if (route === 'gifts') {
    if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);
    const event = await requireEvent(req, res);
    if (!event) return;
    if (req.method === 'GET') return listGiftCampaigns(res, event);
    return createGiftCampaign(req, res, event);
  }
  if (segments[0] === 'gifts' && segments.length === 2) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return getGiftCampaignDetail(res, segments[1]);
  }
  if (segments[0] === 'gifts' && segments.length === 3 && segments[2] === 'close') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return closeGiftCampaign(res, segments[1]);
  }
  if (route === 'wallet/google/ensure-class') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const event = await requireEvent(req, res);
    if (!event) return;
    return ensureWalletClass(res, event);
  }

  return sendJson(res, 404, { error: 'not_found' });
});

// --- Orders --------------------------------------------------------------------

// `event` distinguishes the two callers: admin (an event) gets that event's
// recent list plus its sales/revenue stats; the support role (null) searches
// ACROSS events, gets only the matching orders (each tagged with its event) and
// MUST provide a search term — an empty query returns nothing so the whole
// table is never dumped (this also doubles as the support login check).
async function listOrders(
  req: VercelRequest,
  res: VercelResponse,
  event: EventRow | null
): Promise<void> {
  const includeStats = event !== null;
  const supabase = getSupabase();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  if (!includeStats && !q) {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, { orders: [] });
  }

  let query = supabase
    .from('orders')
    .select('*, events(slug, code, name, short_name)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (event) query = query.eq('event_id', event.id);
  if (status && ORDER_STATUSES.includes(status)) {
    query = query.eq('status', status);
  }
  if (q) {
    // A full order id pasted into the search box does an exact lookup; anything
    // else is a case-insensitive substring match on name / email / phone.
    if (UUID_RE.test(q)) {
      query = query.eq('id', q);
    } else {
      const safe = q.replace(/[%,]/g, '');
      query = query.or(
        `buyer_name.ilike.%${safe}%,buyer_email.ilike.%${safe}%,buyer_phone.ilike.%${safe}%`
      );
    }
  }

  const { data: orders, error } = await query;
  if (error) throw new Error(`orders query failed: ${error.message}`);

  if (!includeStats) {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, { orders: orders ?? [] });
  }

  // --- Stats ---
  const { data: presale, error: presaleErr } = await supabase
    .rpc('presale_status', { p_event_id: event.id })
    .single<PresaleStatus>();
  if (presaleErr) throw new Error(`presale_status failed: ${presaleErr.message}`);

  const { data: paidOrders, error: paidErr } = await supabase
    .from('orders')
    .select('tier, quantity, total_cents, net_cents, fee_cents, payment_method')
    .eq('event_id', event.id)
    .eq('status', 'paid');
  if (paidErr) throw new Error(`stats query failed: ${paidErr.message}`);

  // Refunded orders are excluded from every revenue figure above (those only
  // count status='paid'); report them separately for reconciliation.
  const { data: refundedOrders, error: refundedErr } = await supabase
    .from('orders')
    .select('quantity, total_cents')
    .eq('event_id', event.id)
    .eq('status', 'refunded');
  if (refundedErr) throw new Error(`refund stats query failed: ${refundedErr.message}`);
  const refunded = (refundedOrders ?? []) as Pick<Order, 'quantity' | 'total_cents'>[];

  const paid = (paidOrders ?? []) as Pick<
    Order,
    'tier' | 'quantity' | 'total_cents' | 'net_cents' | 'fee_cents' | 'payment_method'
  >[];
  const sumQty = (rows: typeof paid) => rows.reduce((sum, o) => sum + o.quantity, 0);
  // revenueByMethod reporta el NETO por método (lo que realmente recibe la
  // banda), no el bruto cobrado: el recargo por servicio solo cubre la comisión.
  const revenueByMethod: Record<string, number> = { yappy: 0, cuantoapp: 0, cash: 0 };
  for (const o of paid) {
    if (o.payment_method in revenueByMethod) {
      revenueByMethod[o.payment_method] += o.net_cents;
    }
  }

  const stats = {
    presale: {
      capacity: presale!.capacity,
      paid: presale!.paid_count,
      pending: presale!.pending_count,
      courtesy: presale!.courtesy_count,
      available: presale!.available,
      stage2Active: presale!.stage2_active,
      stage2Cap: presale!.stage2_cap,
      soldOut: presale!.sold_out
    },
    generalPaid: sumQty(paid.filter((o) => o.tier === 'general')),
    courtesyTickets: sumQty(paid.filter((o) => o.tier === 'cortesia')),
    totalTicketsPaid: sumQty(paid),
    // revenueCents = neto que recibe la banda. feesCents = recargos por servicio
    // que se fueron en comisiones. grossCents = total cobrado al comprador.
    revenueCents: paid.reduce((sum, o) => sum + o.net_cents, 0),
    feesCents: paid.reduce((sum, o) => sum + o.fee_cents, 0),
    grossCents: paid.reduce((sum, o) => sum + o.total_cents, 0),
    revenueByMethod,
    // Reembolsos (no cuentan en los ingresos de arriba).
    refundedOrders: refunded.length,
    refundedTickets: refunded.reduce((sum, o) => sum + o.quantity, 0),
    refundedGrossCents: refunded.reduce((sum, o) => sum + o.total_cents, 0)
  };

  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, { orders: orders ?? [], stats });
}

async function markOrderPaid(req: VercelRequest, res: VercelResponse, id: string): Promise<void> {
  const body = parseBody<{ payment_ref?: string }>(req);
  const paymentRef = (body.payment_ref ?? '').trim() || null;

  try {
    const result = await issueOrder(id, paymentRef);
    return sendJson(res, 200, {
      orderId: result.order.id,
      status: result.order.status,
      ticketCount: result.ticketCount,
      emailed: result.emailed
    });
  } catch (err) {
    if (err instanceof IssueError) {
      if (err.code === 'order_not_found') return sendJson(res, 404, { error: 'order_not_found' });
      if (err.code === 'order_cancelled') return sendJson(res, 409, { error: 'order_cancelled' });
    }
    throw err;
  }
}

// Cancels ONE pending order, freeing its presale cupo instantly (capacity only
// counts status='pending'). Paid orders cannot be cancelled — revoke their
// tickets instead, so the audit trail (payment received) stays intact.
async function cancelOrder(res: VercelResponse, id: string): Promise<void> {
  const supabase = getSupabase();
  const { data: updated, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, status');
  if (error) throw new Error(`cancel order failed: ${error.message}`);

  if ((updated ?? []).length === 1) {
    return sendJson(res, 200, { orderId: id, status: 'cancelled' });
  }

  const { data: order, error: fetchErr } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle<Pick<Order, 'id' | 'status'>>();
  if (fetchErr) throw new Error(`cancel order lookup failed: ${fetchErr.message}`);
  if (!order) return sendJson(res, 404, { error: 'order_not_found' });
  if (order.status === 'cancelled') return sendJson(res, 200, { orderId: id, status: 'cancelled' });
  return sendJson(res, 409, { error: 'order_paid' });
}

// Best-effort client IP for the Yappy reversal's `client-ip` header. Vercel
// puts the real chain in x-forwarded-for (client first).
function clientIpOf(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const ip = raw?.split(',')[0].trim() || (req.headers['x-real-ip'] as string) || '';
  return ip || '0.0.0.0';
}

// Refunds a paid order: reverses the Yappy charge (when applicable) and voids
// its tickets. Body: { manual?: boolean, refund_ref?: string }. `manual` skips
// the Yappy API call (cash/CuantoApp, or a Yappy charge already settled that the
// admin reverses by hand). Paid orders are never "cancelled" — this is how the
// money side is undone while keeping the audit trail.
async function refund(req: VercelRequest, res: VercelResponse, id: string): Promise<void> {
  const body = parseBody<{ manual?: boolean; refund_ref?: string }>(req);
  const manual = body.manual === true;
  const refundRef = (body.refund_ref ?? '').trim() || null;

  try {
    const result = await refundOrder(id, { manual, refundRef, clientIp: clientIpOf(req) });
    return sendJson(res, 200, {
      orderId: result.order.id,
      status: result.order.status,
      via: result.via,
      voidedCount: result.voidedCount,
      refundRef: result.refundRef
    });
  } catch (err) {
    if (err instanceof RefundError) {
      if (err.code === 'order_not_found') return sendJson(res, 404, { error: 'order_not_found' });
      if (err.code === 'order_not_paid') return sendJson(res, 409, { error: 'order_not_paid' });
      if (err.code === 'no_transaction_id') return sendJson(res, 409, { error: 'no_transaction_id' });
      if (err.code === 'yappy_not_configured') return sendJson(res, 501, { error: 'yappy_not_configured' });
      if (err.code === 'yappy_failed') {
        return sendJson(res, 502, { error: 'yappy_failed', code: err.yappyCode });
      }
    }
    throw err;
  }
}

// Returns a printable HTML "comprobante de reembolso" for a refunded order.
// Read-only and idempotent: it renders entirely from the stored order row, so a
// receipt can be generated at any time, even days after the refund happened.
async function refundReceipt(res: VercelResponse, id: string): Promise<void> {
  if (!UUID_RE.test(id)) return sendJson(res, 404, { error: 'order_not_found' });
  const supabase = getSupabase();

  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .maybeSingle<Order>();
  if (error) throw new Error(`refund receipt lookup failed: ${error.message}`);
  if (!order) return sendJson(res, 404, { error: 'order_not_found' });
  if (order.status !== 'refunded') return sendJson(res, 409, { error: 'order_not_refunded' });

  const event = await getEventById(order.event_id);
  if (!event) throw new Error(`event ${order.event_id} not found for order ${order.id}`);
  return sendHtml(res, 200, buildRefundReceiptHtml(order, event));
}

async function resendEmail(res: VercelResponse, id: string): Promise<void> {
  try {
    const result = await resendOrderEmail(id);
    return sendJson(res, 200, { orderId: result.order.id, ticketCount: result.ticketCount });
  } catch (err) {
    if (err instanceof IssueError) {
      if (err.code === 'order_not_found') return sendJson(res, 404, { error: 'order_not_found' });
      if (err.code === 'order_not_paid') return sendJson(res, 409, { error: 'order_not_paid' });
      if (err.code === 'no_valid_tickets') return sendJson(res, 409, { error: 'no_valid_tickets' });
    }
    throw err;
  }
}

// One order plus its tickets, for the support detail view. Read-only: support
// can see ticket statuses (valid / used / void) but cannot change them.
async function getOrderDetail(res: VercelResponse, id: string): Promise<void> {
  if (!UUID_RE.test(id)) return sendJson(res, 404, { error: 'order_not_found' });
  const supabase = getSupabase();

  const { data: order, error } = await supabase
    .from('orders')
    .select('*, events(slug, code, name, short_name)')
    .eq('id', id)
    .maybeSingle<Order>();
  if (error) throw new Error(`order lookup failed: ${error.message}`);
  if (!order) return sendJson(res, 404, { error: 'order_not_found' });

  const { data: tickets, error: ticketsErr } = await supabase
    .from('tickets')
    .select('id, order_id, tier, status, used_at, used_by, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true });
  if (ticketsErr) throw new Error(`order tickets lookup failed: ${ticketsErr.message}`);

  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, { order, tickets: tickets ?? [] });
}

async function cleanupOrders(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cron uses GET; the admin button uses POST.
  if (req.method !== 'POST' && req.method !== 'GET') {
    return methodNotAllowed(res, ['POST', 'GET']);
  }
  const { data, error } = await getSupabase().rpc('cleanup_expired_orders');
  if (error) throw new Error(`cleanup failed: ${error.message}`);
  return sendJson(res, 200, { cancelled: data ?? 0 });
}

// --- Presale -------------------------------------------------------------------

async function toggleStage2(req: VercelRequest, res: VercelResponse, event: EventRow): Promise<void> {
  const body = parseBody<{ active?: boolean; cap?: number }>(req);
  if (typeof body.active !== 'boolean') {
    return sendJson(res, 400, { error: 'invalid_active' });
  }

  const update: {
    presale_stage2_active: boolean;
    presale_stage2_cap?: number;
    updated_at: string;
  } = { presale_stage2_active: body.active, updated_at: new Date().toISOString() };

  // Al activar, el admin elige cuántas entradas extra libera la Etapa 2. Al
  // desactivar, el cap es irrelevante (la capacidad ignora stage2_cap), así que
  // no lo tocamos: conservamos el último valor como preset del input.
  if (body.active && body.cap !== undefined) {
    if (!Number.isInteger(body.cap) || body.cap < 0) {
      return sendJson(res, 400, { error: 'invalid_cap' });
    }
    update.presale_stage2_cap = body.cap;
  }

  const { data, error } = await getSupabase()
    .from('events')
    .update(update)
    .eq('id', event.id)
    .select('presale_stage2_active, presale_stage2_cap')
    .single<{ presale_stage2_active: boolean; presale_stage2_cap: number }>();
  if (error) throw new Error(`stage2 toggle failed: ${error.message}`);

  return sendJson(res, 200, {
    stage2Active: data!.presale_stage2_active,
    stage2Cap: data!.presale_stage2_cap
  });
}

// --- Tickets -------------------------------------------------------------------

interface TicketRow extends Pick<Ticket, 'id' | 'order_id' | 'tier' | 'status' | 'used_at' | 'used_by' | 'created_at'> {
  orders: { buyer_name: string; buyer_email: string } | null;
}

async function listTickets(req: VercelRequest, res: VercelResponse, event: EventRow): Promise<void> {
  const supabase = getSupabase();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const tier = typeof req.query.tier === 'string' ? req.query.tier : '';

  let query = supabase
    .from('tickets')
    .select('id, order_id, tier, status, used_at, used_by, created_at, orders!inner(buyer_name, buyer_email)')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (status && TICKET_STATUSES.includes(status)) {
    query = query.eq('status', status);
  }
  if (tier && TICKET_TIERS.includes(tier)) {
    query = query.eq('tier', tier);
  }
  if (q) {
    const safe = q.replace(/[%,]/g, '');
    query = query.or(
      `buyer_name.ilike.%${safe}%,buyer_email.ilike.%${safe}%,buyer_phone.ilike.%${safe}%`,
      { foreignTable: 'orders' }
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`tickets query failed: ${error.message}`);

  const tickets = ((data ?? []) as unknown as TicketRow[]).map((row) => ({
    id: row.id,
    order_id: row.order_id,
    tier: row.tier,
    status: row.status,
    used_at: row.used_at,
    used_by: row.used_by,
    created_at: row.created_at,
    buyer_name: row.orders?.buyer_name ?? '',
    buyer_email: row.orders?.buyer_email ?? ''
  }));

  // Event-wide usage stats, unaffected by the list filters above.
  const { data: allRows, error: statsErr } = await supabase
    .from('tickets')
    .select('tier, status')
    .eq('event_id', event.id)
    .limit(10000);
  if (statsErr) throw new Error(`ticket stats query failed: ${statsErr.message}`);

  const emptyCounts = () => ({ total: 0, valid: 0, used: 0, void: 0 });
  const totals = emptyCounts();
  const byTier: Record<string, ReturnType<typeof emptyCounts>> = {};
  for (const row of (allRows ?? []) as Pick<Ticket, 'tier' | 'status'>[]) {
    const bucket = (byTier[row.tier] ??= emptyCounts());
    totals.total += 1;
    bucket.total += 1;
    totals[row.status] += 1;
    bucket[row.status] += 1;
  }

  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, { tickets, stats: { ...totals, byTier } });
}

// Revoke (valid -> void) and unrevoke (void -> valid) as a single atomic
// conditional UPDATE — same anti-race pattern as validate_ticket. A used
// ticket can't transition either way: the person is already inside.
async function setTicketStatus(
  res: VercelResponse,
  id: string,
  target: 'void' | 'valid'
): Promise<void> {
  const supabase = getSupabase();
  const from = target === 'void' ? 'valid' : 'void';

  const { data: updated, error } = await supabase
    .from('tickets')
    .update({ status: target })
    .eq('id', id)
    .eq('status', from)
    .select('id, status');
  if (error) throw new Error(`ticket ${target} failed: ${error.message}`);

  if ((updated ?? []).length === 1) {
    return sendJson(res, 200, { ticketId: id, status: target });
  }

  const { data: ticket, error: fetchErr } = await supabase
    .from('tickets')
    .select('id, status')
    .eq('id', id)
    .maybeSingle<Pick<Ticket, 'id' | 'status'>>();
  if (fetchErr) throw new Error(`ticket lookup failed: ${fetchErr.message}`);
  if (!ticket) return sendJson(res, 404, { error: 'ticket_not_found' });
  if (ticket.status === target) return sendJson(res, 200, { ticketId: id, status: target });
  return sendJson(res, 409, { error: 'ticket_used' });
}

// --- Courtesy ------------------------------------------------------------------

interface CourtesyBody {
  buyer_name?: string;
  buyer_email?: string;
  quantity?: number;
  note?: string;
  send_email?: boolean;
}

// Creates a $0 courtesy order and funnels it through the SAME issuance routine
// as every payment method (pending -> paid via issueOrder), so tickets and the
// email behave identically to a purchase. Paid courtesy orders consume presale
// cupo (counted by presale_status/create_order since migration 0004), but the
// admin is never blocked by the cap: overshooting just shows presale sold out.
async function createCourtesy(req: VercelRequest, res: VercelResponse, event: EventRow): Promise<void> {
  const body = parseBody<CourtesyBody>(req);
  const buyerName = (body.buyer_name ?? '').trim();
  const buyerEmail = (body.buyer_email ?? '').trim().toLowerCase();
  const quantity = Number(body.quantity);
  const note = (body.note ?? '').trim() || null;
  const sendEmail = body.send_email !== false;

  if (buyerName.length < 2) return sendJson(res, 400, { error: 'invalid_name' });
  if (!EMAIL_RE.test(buyerEmail)) return sendJson(res, 400, { error: 'invalid_email' });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ORDER) {
    return sendJson(res, 400, { error: 'invalid_quantity' });
  }

  const supabase = getSupabase();
  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      event_id: event.id,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      tier: 'cortesia',
      quantity,
      total_cents: 0,
      net_cents: 0,
      fee_cents: 0,
      payment_method: 'courtesy',
      status: 'pending',
      // Pre-stamping emailed_at makes issueOrder skip the email when the
      // admin opted out (it can still be sent later via resend-email).
      emailed_at: sendEmail ? null : new Date().toISOString()
    })
    .select('*')
    .single<Order>();
  if (error) throw new Error(`courtesy insert failed: ${error.message}`);

  const result = await issueOrder(order!.id, note);
  return sendJson(res, 201, {
    orderId: result.order.id,
    ticketCount: result.ticketCount,
    emailed: result.emailed
  });
}

// --- Gift campaigns ------------------------------------------------------------

// A gift campaign is a hidden URL (/regalo/<token>) reachable only by scanning a
// QR generated here. The first N people to submit the public form get a 'regalo'
// ticket. The token is a long random secret; unguessability is the security.
const GIFT_TOKEN_BYTES = 32; // 256-bit; base64url ~43 chars

function giftCampaignUrl(token: string): string {
  return `${env.publicBaseUrl}/regalo/${token}`;
}

interface CreateGiftBody {
  max_gifts?: number;
}

async function createGiftCampaign(req: VercelRequest, res: VercelResponse, event: EventRow): Promise<void> {
  const body = parseBody<CreateGiftBody>(req);
  const maxGifts = Number(body.max_gifts);
  // No hard upper bound on N, but keep it sane.
  if (!Number.isInteger(maxGifts) || maxGifts < 1 || maxGifts > 10000) {
    return sendJson(res, 400, { error: 'invalid_max_gifts' });
  }

  const token = randomBytes(GIFT_TOKEN_BYTES).toString('base64url');
  const supabase = getSupabase();
  const { data: campaign, error } = await supabase
    .from('gift_campaign')
    .insert({ token, max_gifts: maxGifts, event_id: event.id })
    .select('*')
    .single<GiftCampaign>();
  if (error) throw new Error(`gift campaign insert failed: ${error.message}`);

  const url = giftCampaignUrl(campaign!.token);
  const qrDataUrl = await tokenToDataUrl(url);
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 201, { campaign, url, qrDataUrl });
}

async function listGiftCampaigns(res: VercelResponse, event: EventRow): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('gift_campaign')
    .select('*')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`gift campaigns query failed: ${error.message}`);

  const campaigns = ((data ?? []) as GiftCampaign[]).map((c) => ({
    ...c,
    url: giftCampaignUrl(c.token)
  }));
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, { campaigns });
}

async function getGiftCampaignDetail(res: VercelResponse, id: string): Promise<void> {
  if (!UUID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_id' });
  const supabase = getSupabase();

  const { data: campaign, error } = await supabase
    .from('gift_campaign')
    .select('*')
    .eq('id', id)
    .maybeSingle<GiftCampaign>();
  if (error) throw new Error(`gift campaign lookup failed: ${error.message}`);
  if (!campaign) return sendJson(res, 404, { error: 'not_found' });

  const { data: claims, error: claimsError } = await supabase
    .from('gift_claim')
    .select('id, name, email, phone, order_id, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: true });
  if (claimsError) throw new Error(`gift claims query failed: ${claimsError.message}`);

  const url = giftCampaignUrl(campaign.token);
  const qrDataUrl = await tokenToDataUrl(url);
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, {
    campaign,
    url,
    qrDataUrl,
    claims: (claims ?? []) as Partial<GiftClaim>[]
  });
}

// Manual early close. Only an active campaign can be closed; exhausted ones are
// already terminal. Idempotent-ish: closing a non-active campaign just no-ops.
async function closeGiftCampaign(res: VercelResponse, id: string): Promise<void> {
  if (!UUID_RE.test(id)) return sendJson(res, 400, { error: 'invalid_id' });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('gift_campaign')
    .update({ status: 'closed' })
    .eq('id', id)
    .eq('status', 'active')
    .select('*')
    .maybeSingle<GiftCampaign>();
  if (error) throw new Error(`gift campaign close failed: ${error.message}`);
  if (!data) return sendJson(res, 409, { error: 'not_active' });
  return sendJson(res, 200, { campaign: data });
}

// --- Google Wallet -------------------------------------------------------------

// Creates THIS event's Passes Class once (idempotent — see ensureEventTicketClass).
// Run it after setting the GOOGLE_WALLET_* env vars and before passes can be
// saved; re-running it when the class already exists is a no-op.
async function ensureWalletClass(res: VercelResponse, event: EventRow): Promise<void> {
  if (!isGoogleWalletConfigured()) {
    return sendJson(res, 400, { error: 'google_wallet_not_configured' });
  }
  const result = await ensureEventTicketClass(event);
  return sendJson(res, 200, result);
}

// --- Events ----------------------------------------------------------------------

// Metrics next to each event so the selector/table shows where each show stands.
async function listEvents(res: VercelResponse): Promise<void> {
  const supabase = getSupabase();
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .order('starts_at', { ascending: false });
  if (error) throw new Error(`events query failed: ${error.message}`);

  const { data: tiers, error: tiersErr } = await supabase.from('event_tier').select('event_id, tier, price_cents');
  if (tiersErr) throw new Error(`event tiers query failed: ${tiersErr.message}`);

  const { data: paid, error: paidErr } = await supabase
    .from('orders')
    .select('event_id, quantity')
    .eq('status', 'paid')
    .limit(20000);
  if (paidErr) throw new Error(`event metrics query failed: ${paidErr.message}`);

  const paidByEvent: Record<string, number> = {};
  for (const o of (paid ?? []) as { event_id: string; quantity: number }[]) {
    paidByEvent[o.event_id] = (paidByEvent[o.event_id] ?? 0) + o.quantity;
  }
  const tiersByEvent: Record<string, Record<string, number>> = {};
  for (const t of (tiers ?? []) as { event_id: string; tier: string; price_cents: number }[]) {
    (tiersByEvent[t.event_id] ??= {})[t.tier] = t.price_cents;
  }

  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, {
    events: ((events ?? []) as EventRow[]).map((e) => ({
      ...e,
      tiers: { preventa: tiersByEvent[e.id]?.preventa ?? 0, general: tiersByEvent[e.id]?.general ?? 0 },
      paidTickets: paidByEvent[e.id] ?? 0
    }))
  });
}

interface EventBody {
  slug?: unknown;
  code?: unknown;
  name?: unknown;
  short_name?: unknown;
  venue?: unknown;
  venue_address?: unknown;
  starts_at?: unknown;
  presale_start?: unknown;
  presale_end?: unknown;
  sales_end?: unknown;
  event_end?: unknown;
  presale_stage1_cap?: unknown;
  presale_stage2_cap?: unknown;
  total_capacity?: unknown;
  theme?: unknown;
  og_image_url?: unknown;
  tiers?: { preventa?: unknown; general?: unknown };
}

const EVENT_DATE_FIELDS = ['starts_at', 'presale_start', 'presale_end', 'sales_end', 'event_end'] as const;
const THEME_RE = /^[a-z0-9-]+$/;

type EventFields = Partial<
  Pick<
    EventRow,
    | 'slug'
    | 'code'
    | 'name'
    | 'short_name'
    | 'venue'
    | 'venue_address'
    | (typeof EVENT_DATE_FIELDS)[number]
    | 'presale_stage1_cap'
    | 'presale_stage2_cap'
    | 'total_capacity'
    | 'theme'
    | 'og_image_url'
  >
>;

/**
 * Validates the fields present in `body` (all optional here: create checks the
 * required ones afterwards). Returns the normalized fields + tier prices, or an
 * error code for a 400.
 */
function parseEventBody(
  body: EventBody
): { fields: EventFields; tiers: Partial<Record<'preventa' | 'general', number>> } | { error: string } {
  const fields: EventFields = {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  if (body.slug !== undefined) {
    const slug = str(body.slug).toLowerCase();
    if (!EVENT_SLUG_RE.test(slug)) return { error: 'invalid_slug' };
    fields.slug = slug;
  }
  if (body.code !== undefined) {
    const code = str(body.code).toUpperCase();
    if (!EVENT_CODE_RE.test(code)) return { error: 'invalid_code' };
    fields.code = code;
  }
  if (body.name !== undefined) {
    const name = str(body.name);
    if (name.length < 2 || name.length > 120) return { error: 'invalid_name' };
    fields.name = name;
  }
  if (body.short_name !== undefined) {
    const shortName = str(body.short_name);
    if (shortName.length < 2 || shortName.length > 24) return { error: 'invalid_short_name' };
    fields.short_name = shortName;
  }
  if (body.venue !== undefined) fields.venue = str(body.venue).slice(0, 120) || null;
  if (body.venue_address !== undefined) fields.venue_address = str(body.venue_address).slice(0, 240) || null;
  for (const key of EVENT_DATE_FIELDS) {
    if (body[key] === undefined) continue;
    const d = new Date(str(body[key]));
    if (Number.isNaN(d.getTime())) return { error: `invalid_${key}` };
    fields[key] = d.toISOString();
  }
  for (const key of ['presale_stage1_cap', 'presale_stage2_cap', 'total_capacity'] as const) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < (key === 'total_capacity' ? 1 : 0) || n > 100000) {
      return { error: `invalid_${key}` };
    }
    fields[key] = n;
  }
  if (body.theme !== undefined) {
    const theme = str(body.theme) || 'default';
    if (!THEME_RE.test(theme)) return { error: 'invalid_theme' };
    fields.theme = theme;
  }
  if (body.og_image_url !== undefined) {
    const url = str(body.og_image_url);
    if (url && !/^https:\/\/\S+$/.test(url)) return { error: 'invalid_og_image_url' };
    fields.og_image_url = url || null;
  }

  const tiers: Partial<Record<'preventa' | 'general', number>> = {};
  for (const tier of ['preventa', 'general'] as const) {
    const raw = body.tiers?.[tier];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) return { error: `invalid_price_${tier}` };
    tiers[tier] = n;
  }
  return { fields, tiers };
}

/** presale_start ≤ presale_end ≤ sales_end ≤ event_end (mirrors the DB check). */
function datesInOrder(e: Pick<EventRow, 'presale_start' | 'presale_end' | 'sales_end' | 'event_end'>): boolean {
  const t = (iso: string) => new Date(iso).getTime();
  return t(e.presale_start) <= t(e.presale_end) && t(e.presale_end) <= t(e.sales_end) && t(e.sales_end) <= t(e.event_end);
}

async function upsertTiers(eventId: string, tiers: Partial<Record<'preventa' | 'general', number>>): Promise<void> {
  const rows = Object.entries(tiers).map(([tier, price_cents]) => ({ event_id: eventId, tier, price_cents }));
  if (rows.length === 0) return;
  const { error } = await getSupabase().from('event_tier').upsert(rows, { onConflict: 'event_id,tier' });
  if (error) throw new Error(`event tiers upsert failed: ${error.message}`);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

async function createEvent(req: VercelRequest, res: VercelResponse): Promise<void> {
  const parsed = parseEventBody(parseBody<EventBody>(req));
  if ('error' in parsed) return sendJson(res, 400, { error: parsed.error });
  const { fields, tiers } = parsed;

  for (const key of ['slug', 'code', 'name', 'short_name', ...EVENT_DATE_FIELDS] as const) {
    if (fields[key] === undefined) return sendJson(res, 400, { error: `missing_${key}` });
  }
  if (!datesInOrder(fields as EventRow)) return sendJson(res, 400, { error: 'invalid_date_order' });
  if (tiers.preventa === undefined || tiers.general === undefined) {
    return sendJson(res, 400, { error: 'missing_tiers' });
  }

  const { data: event, error } = await getSupabase()
    .from('events')
    .insert({ ...fields, status: 'draft' })
    .select('*')
    .single<EventRow>();
  if (isUniqueViolation(error)) return sendJson(res, 409, { error: 'slug_or_code_taken' });
  if (error) throw new Error(`event insert failed: ${error.message}`);

  await upsertTiers(event!.id, tiers);
  return sendJson(res, 201, { event: { ...event!, tiers: await getTierPrices(event!.id) } });
}

async function updateEvent(req: VercelRequest, res: VercelResponse, id: string): Promise<void> {
  const current = await getEventById(id);
  if (!current) return sendJson(res, 404, { error: 'event_not_found' });
  if (current.status === 'archived') return sendJson(res, 409, { error: 'event_archived' });

  const parsed = parseEventBody(parseBody<EventBody>(req));
  if ('error' in parsed) return sendJson(res, 400, { error: parsed.error });
  const { fields, tiers } = parsed;

  // The code is signed into every QR and the slug is the public URL: once
  // tickets exist, changing either would orphan them.
  const identityChanged =
    (fields.code !== undefined && fields.code !== current.code) ||
    (fields.slug !== undefined && fields.slug !== current.slug);
  if (identityChanged) {
    const { count, error } = await getSupabase()
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', id);
    if (error) throw new Error(`event tickets count failed: ${error.message}`);
    if ((count ?? 0) > 0) return sendJson(res, 409, { error: 'identity_locked' });
  }

  if (!datesInOrder({ ...current, ...fields })) return sendJson(res, 400, { error: 'invalid_date_order' });

  if (Object.keys(fields).length > 0) {
    const { error } = await getSupabase()
      .from('events')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (isUniqueViolation(error)) return sendJson(res, 409, { error: 'slug_or_code_taken' });
    if (error) throw new Error(`event update failed: ${error.message}`);
  }
  await upsertTiers(id, tiers);

  const updated = await getEventById(id);
  return sendJson(res, 200, { event: { ...updated!, tiers: await getTierPrices(id) } });
}

async function setEventStatus(req: VercelRequest, res: VercelResponse, id: string): Promise<void> {
  const body = parseBody<{ status?: string }>(req);
  const target = body.status as EventStatus;
  const current = await getEventById(id);
  if (!current) return sendJson(res, 404, { error: 'event_not_found' });
  if (!canTransition(current.status, target)) {
    return sendJson(res, 409, { error: 'invalid_transition', from: current.status, to: body.status ?? null });
  }
  // Going on sale with a free sellable tier would create $0 orders.
  if (target === 'on_sale') {
    const prices = await getTierPrices(id);
    if (!(prices.preventa > 0) || !(prices.general > 0)) {
      return sendJson(res, 409, { error: 'missing_prices' });
    }
  }

  // Conditional on the status we validated against, so two admins racing
  // can't apply an invalid chain of transitions.
  const { data, error } = await getSupabase()
    .from('events')
    .update({ status: target, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', current.status)
    .select('*')
    .maybeSingle<EventRow>();
  if (error) throw new Error(`event status update failed: ${error.message}`);
  if (!data) return sendJson(res, 409, { error: 'status_changed' });
  return sendJson(res, 200, { event: data });
}
