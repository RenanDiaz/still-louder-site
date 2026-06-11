import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from './_lib/supabase.js';
import { isAdmin, isCron } from './_lib/auth.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from './_lib/http.js';
import { issueOrder, resendOrderEmail, IssueError } from './_lib/issue.js';
import { MAX_QUANTITY_PER_ORDER } from './_lib/pricing.js';
import type { Order, PresaleStatus, Ticket } from './_lib/types.js';

// Single function for EVERY /api/admin/* route. Vercel Hobby caps a deployment
// at 12 serverless functions, so all admin endpoints share one function instead
// of one file each. Catch-all filenames ([...path].ts) only work in Next.js —
// in a plain api/ directory they deploy but never match, so requests 404. This
// file therefore lives at the fixed path /api/admin and a rewrite in
// vercel.json maps /api/admin/:path* onto it, passing the sub-path in the
// `path` query param:
//
//   GET  /api/admin/orders?q=&status=          order list + sales stats
//   POST /api/admin/orders/cleanup             cancel expired pendings (also GET, cron)
//   POST /api/admin/orders/:id/mark-paid       mark paid -> issue tickets + email
//   POST /api/admin/orders/:id/cancel          cancel a specific pending order
//   POST /api/admin/orders/:id/resend-email    re-send the QR email for a paid order
//   POST /api/admin/presale/stage2             toggle the second presale stage
//   GET  /api/admin/tickets?q=&status=&tier=   ticket list + usage stats
//   POST /api/admin/tickets/:id/revoke         valid -> void (gate will reject it)
//   POST /api/admin/tickets/:id/unrevoke       void -> valid
//   POST /api/admin/courtesy                   create + issue a courtesy order ($0)
//
// Everything is admin-gated except orders/cleanup, which also accepts the cron
// secret (the daily Vercel Cron hits it with GET).

const ORDER_STATUSES = ['pending', 'paid', 'cancelled'];
const TICKET_STATUSES = ['valid', 'used', 'void'];
const TICKET_TIERS = ['preventa', 'general', 'cortesia'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  // The rewrite delivers the sub-path slash-joined in `path`
  // (e.g. "orders/<id>/mark-paid"); split it back into segments.
  const raw = req.query.path;
  const joined = Array.isArray(raw) ? raw.join('/') : typeof raw === 'string' ? raw : '';
  const segments = joined.split('/').filter(Boolean);
  const route = segments.join('/');

  // cleanup is the only route the cron may call; everything else is admin-only.
  if (route === 'orders/cleanup') {
    if (!isAdmin(req) && !isCron(req)) return sendJson(res, 401, { error: 'unauthorized' });
    return cleanupOrders(req, res);
  }
  if (!isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized' });

  if (route === 'orders') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return listOrders(req, res);
  }
  if (segments[0] === 'orders' && segments.length === 3) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const [, id, action] = segments;
    if (action === 'mark-paid') return markOrderPaid(req, res, id);
    if (action === 'cancel') return cancelOrder(res, id);
    if (action === 'resend-email') return resendEmail(res, id);
  }
  if (route === 'presale/stage2') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return toggleStage2(req, res);
  }
  if (route === 'tickets') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return listTickets(req, res);
  }
  if (segments[0] === 'tickets' && segments.length === 3) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const [, id, action] = segments;
    if (action === 'revoke') return setTicketStatus(res, id, 'void');
    if (action === 'unrevoke') return setTicketStatus(res, id, 'valid');
  }
  if (route === 'courtesy') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    return createCourtesy(req, res);
  }

  return sendJson(res, 404, { error: 'not_found' });
});

// --- Orders --------------------------------------------------------------------

async function listOrders(req: VercelRequest, res: VercelResponse): Promise<void> {
  const supabase = getSupabase();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (status && ORDER_STATUSES.includes(status)) {
    query = query.eq('status', status);
  }
  if (q) {
    const safe = q.replace(/[%,]/g, '');
    query = query.or(`buyer_name.ilike.%${safe}%,buyer_email.ilike.%${safe}%`);
  }

  const { data: orders, error } = await query;
  if (error) throw new Error(`orders query failed: ${error.message}`);

  // --- Stats ---
  const { data: presale, error: presaleErr } = await supabase
    .rpc('presale_status')
    .single<PresaleStatus>();
  if (presaleErr) throw new Error(`presale_status failed: ${presaleErr.message}`);

  const { data: paidOrders, error: paidErr } = await supabase
    .from('orders')
    .select('tier, quantity, total_cents, payment_method')
    .eq('status', 'paid');
  if (paidErr) throw new Error(`stats query failed: ${paidErr.message}`);

  const paid = (paidOrders ?? []) as Pick<
    Order,
    'tier' | 'quantity' | 'total_cents' | 'payment_method'
  >[];
  const sumQty = (rows: typeof paid) => rows.reduce((sum, o) => sum + o.quantity, 0);
  const revenueByMethod: Record<string, number> = { yappy: 0, cuantoapp: 0, cash: 0 };
  for (const o of paid) {
    if (o.payment_method in revenueByMethod) {
      revenueByMethod[o.payment_method] += o.total_cents;
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
      soldOut: presale!.sold_out
    },
    generalPaid: sumQty(paid.filter((o) => o.tier === 'general')),
    courtesyTickets: sumQty(paid.filter((o) => o.tier === 'cortesia')),
    totalTicketsPaid: sumQty(paid),
    revenueCents: paid.reduce((sum, o) => sum + o.total_cents, 0),
    revenueByMethod
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

async function toggleStage2(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = parseBody<{ active?: boolean }>(req);
  if (typeof body.active !== 'boolean') {
    return sendJson(res, 400, { error: 'invalid_active' });
  }

  const { data, error } = await getSupabase()
    .from('event_config')
    .update({ presale_stage2_active: body.active, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('presale_stage2_active')
    .single<{ presale_stage2_active: boolean }>();
  if (error) throw new Error(`stage2 toggle failed: ${error.message}`);

  return sendJson(res, 200, { stage2Active: data!.presale_stage2_active });
}

// --- Tickets -------------------------------------------------------------------

interface TicketRow extends Pick<Ticket, 'id' | 'order_id' | 'tier' | 'status' | 'used_at' | 'used_by' | 'created_at'> {
  orders: { buyer_name: string; buyer_email: string } | null;
}

async function listTickets(req: VercelRequest, res: VercelResponse): Promise<void> {
  const supabase = getSupabase();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const tier = typeof req.query.tier === 'string' ? req.query.tier : '';

  let query = supabase
    .from('tickets')
    .select('id, order_id, tier, status, used_at, used_by, created_at, orders!inner(buyer_name, buyer_email)')
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
    query = query.or(`buyer_name.ilike.%${safe}%,buyer_email.ilike.%${safe}%`, {
      foreignTable: 'orders'
    });
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

  // Global usage stats, unaffected by the list filters above.
  const { data: allRows, error: statsErr } = await supabase
    .from('tickets')
    .select('tier, status')
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
async function createCourtesy(req: VercelRequest, res: VercelResponse): Promise<void> {
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
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      tier: 'cortesia',
      quantity,
      total_cents: 0,
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
