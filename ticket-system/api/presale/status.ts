import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../_lib/supabase.js';
import { methodNotAllowed, sendJson, withErrorHandling } from '../_lib/http.js';
import { getTierPrices, publicEvent, resolvePublicEvent } from '../_lib/events.js';
import type { PresaleStatus } from '../_lib/types.js';

// Public: GET /api/presale/status?event=<slug>  (no `event` = the current one).
// Returns the event's public data (name, venue, dates, status, theme, tier
// prices) plus the "quedan N" / "agotado" numbers that drive /entradas. The
// client draws from this; the server still decides what can be sold.
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const raw = req.query.event;
  const slug = (Array.isArray(raw) ? raw[0] : raw ?? '').trim();
  const event = await resolvePublicEvent(slug || null);
  res.setHeader('Cache-Control', 'no-store');
  if (!event) return sendJson(res, 404, { error: 'event_not_found' });

  const tiers = await getTierPrices(event.id);

  // A teaser has nothing on sale: don't compute (or reveal) any capacity.
  if (event.status === 'teaser') {
    return sendJson(res, 200, { event: publicEvent(event, tiers), presale: null });
  }

  const { data, error } = await getSupabase()
    .rpc('presale_status', { p_event_id: event.id })
    .single<PresaleStatus>();
  if (error) throw new Error(`presale_status failed: ${error.message}`);

  // Don't expose raw paid/pending counts publicly; just what the UI needs.
  return sendJson(res, 200, {
    event: publicEvent(event, tiers),
    presale: {
      available: data!.available,
      capacity: data!.capacity,
      stage2Active: data!.stage2_active,
      soldOut: data!.sold_out,
      totalAvailable: data!.total_available,
      eventSoldOut: data!.event_sold_out
    }
  });
});
