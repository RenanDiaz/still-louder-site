import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../_lib/supabase.js';
import { isAdmin, isCron } from '../../_lib/auth.js';
import { methodNotAllowed, sendJson, withErrorHandling } from '../../_lib/http.js';

// POST /api/admin/orders/cleanup -> cancels expired pending orders, freeing
// their reserved presale cupo. Runs on a daily Vercel Cron (authenticated via
// CRON_SECRET) and is also callable manually from the admin panel. This is just
// housekeeping: capacity already excludes expired pending orders by timestamp
// (reservation_expires_at > now()), so a reserva frees its cupo the instant it
// expires, regardless of when this cleanup runs.
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  // Cron uses GET; the admin button uses POST.
  if (req.method !== 'POST' && req.method !== 'GET') {
    return methodNotAllowed(res, ['POST', 'GET']);
  }
  if (!isAdmin(req) && !isCron(req)) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  const { data, error } = await getSupabase().rpc('cleanup_expired_orders');
  if (error) throw new Error(`cleanup failed: ${error.message}`);

  return sendJson(res, 200, { cancelled: data ?? 0 });
});
