import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../_lib/supabase.js';
import { isAdmin } from '../../_lib/auth.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from '../../_lib/http.js';

interface Stage2Body {
  active?: boolean;
}

// POST /api/admin/presale/stage2 { active } -> toggles the second presale stage.
// Activating opens 75 additional cupos immediately (capacity is recomputed live
// from event_config on every check).
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const body = parseBody<Stage2Body>(req);
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
});
