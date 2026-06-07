import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { methodNotAllowed, sendJson, withErrorHandling } from '../_lib/http.js';
import type { PresaleStatus } from '../_lib/types.js';

// Public: powers the "quedan N" / "preventa agotada" indicator on /entradas.
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { data, error } = await getSupabase().rpc('presale_status').single<PresaleStatus>();
  if (error) throw new Error(`presale_status failed: ${error.message}`);

  // Don't expose raw paid/pending counts publicly; just what the UI needs.
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, {
    available: data!.available,
    capacity: data!.capacity,
    stage2Active: data!.stage2_active,
    soldOut: data!.sold_out
  });
});
