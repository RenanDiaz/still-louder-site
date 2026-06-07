import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { isStaff } from '../_lib/auth.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from '../_lib/http.js';
import { verifyToken } from '../_lib/hmac.js';
import type { ValidateResult } from '../_lib/types.js';

interface ValidateBody {
  token?: string;
  station?: string;
}

interface ValidateRow {
  result: ValidateResult;
  ticket_id: string | null;
  tier: string | null;
  used_at: string | null;
  used_by: string | null;
  buyer_name: string | null;
}

// Gate scanner endpoint. Staff-gated. Two-stage defense:
//  1. Verify the HMAC locally — a forged code is rejected WITHOUT a DB hit.
//  2. Only then run the atomic validate_ticket RPC, which flips valid->used in
//     a single statement so concurrent scans of the same code can't both win.
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!isStaff(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const body = parseBody<ValidateBody>(req);
  const token = (body.token ?? '').trim();
  const station = (body.station ?? 'gate').slice(0, 64);

  // Stage 1: signature check, no database access.
  const ticketId = verifyToken(token);
  if (!ticketId) {
    return sendJson(res, 200, { result: 'forged' });
  }

  // Stage 2: atomic claim.
  const { data, error } = await getSupabase()
    .rpc('validate_ticket', { p_ticket_id: ticketId, p_used_by: station })
    .single<ValidateRow>();

  if (error) throw new Error(`validate_ticket failed: ${error.message}`);

  return sendJson(res, 200, {
    result: data!.result, // 'valid' | 'already_used' | 'void' | 'not_found'
    tier: data!.tier,
    usedAt: data!.used_at,
    usedBy: data!.used_by,
    buyerName: data!.buyer_name
  });
});
