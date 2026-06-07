import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../_lib/supabase.js';
import { isAdmin } from '../../_lib/auth.js';
import { methodNotAllowed, sendJson, withErrorHandling } from '../../_lib/http.js';
import type { Order, PresaleStatus } from '../../_lib/types.js';

// GET /api/admin/orders?q=&status=  -> order list + sales stats. Admin-gated.
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const supabase = getSupabase();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (status && ['pending', 'paid', 'cancelled'].includes(status)) {
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
    .select('tier, quantity, total_cents')
    .eq('status', 'paid');
  if (paidErr) throw new Error(`stats query failed: ${paidErr.message}`);

  const paid = (paidOrders ?? []) as Pick<Order, 'tier' | 'quantity' | 'total_cents'>[];
  const stats = {
    presale: {
      capacity: presale!.capacity,
      paid: presale!.paid_count,
      pending: presale!.pending_count,
      available: presale!.available,
      stage2Active: presale!.stage2_active,
      soldOut: presale!.sold_out
    },
    generalPaid: paid
      .filter((o) => o.tier === 'general')
      .reduce((sum, o) => sum + o.quantity, 0),
    totalTicketsPaid: paid.reduce((sum, o) => sum + o.quantity, 0),
    revenueCents: paid.reduce((sum, o) => sum + o.total_cents, 0)
  };

  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, { orders: orders ?? [], stats });
});
