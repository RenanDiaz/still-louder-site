import { getSupabase } from '../_lib/supabase.js';
import { type ApiRequest, type ApiResponse, methodNotAllowed, sendJson, withErrorHandling } from '../_lib/http.js';
import { getTierPrices, publicEvent, resolvePublicEvent, stockVisible } from '../_lib/events.js';
import { MAX_QUANTITY_PER_ORDER } from '../_lib/pricing.js';
import type { PresaleStatus } from '../_lib/types.js';

// Public: GET /api/presale/status?event=<slug>  (no `event` = the current one).
// Returns the event's public data (name, venue, dates, status, theme, tier
// prices) plus the "quedan N" / "agotado" numbers that drive /entradas. The
// client draws from this; the server still decides what can be sold.
export default withErrorHandling(async (req: ApiRequest, res: ApiResponse) => {
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

  // Don't expose raw paid/pending counts publicly; just what the UI needs. The
  // "quedan N" numbers go out only if the event's stock_display allows them
  // (docs/features/contador-boletos.md); null = hidden. The booleans always go:
  // they drive the sold-out/general switch. maxPerOrder caps the quantity
  // picker without sending the count itself (it does reveal it below 10).
  const p = data!;
  const showTotal = stockVisible(event, p.total_available);
  const showPresale = stockVisible(event, p.available);
  return sendJson(res, 200, {
    event: publicEvent(event, tiers),
    presale: {
      available: showPresale ? p.available : null,
      capacity: showPresale ? p.capacity : null,
      stage2Active: p.stage2_active,
      soldOut: p.sold_out,
      totalAvailable: showTotal ? p.total_available : null,
      eventSoldOut: p.event_sold_out,
      maxPerOrder: Math.max(1, Math.min(MAX_QUANTITY_PER_ORDER, p.total_available))
    }
  });
});
