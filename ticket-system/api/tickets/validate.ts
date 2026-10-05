import { getSupabase } from '../_lib/supabase.js';
import { isStaff } from '../_lib/auth.js';
import {
  type ApiRequest,
  type ApiResponse,
  methodNotAllowed,
  parseBody,
  sendJson,
  withErrorHandling
} from '../_lib/http.js';
import { verifyToken } from '../_lib/hmac.js';
import { getEventBySlug, isEventOver, type EventRow } from '../_lib/events.js';
import type { ValidateResult } from '../_lib/types.js';

interface ValidateBody {
  token?: string;
  station?: string;
  event?: string; // slug of the event this gate station is scanning for
}

interface ValidateRow {
  result: ValidateResult;
  ticket_id: string | null;
  tier: string | null;
  used_at: string | null;
  used_by: string | null;
  buyer_name: string | null;
}

function closed(result: ValidateResult, extra: Record<string, unknown> = {}) {
  return { result, tier: null, usedAt: null, usedBy: null, buyerName: null, ...extra };
}

// GET: the events a gate station can pick (not draft/archived), soonest first.
// Staff-gated; lives here so /validar needs no admin rights and no new function.
async function listGateEvents(res: ApiResponse): Promise<void> {
  const { data, error } = await getSupabase()
    .from('events')
    .select('slug, name, short_name, status, starts_at, event_end')
    .in('status', ['teaser', 'on_sale'])
    .order('starts_at', { ascending: true });
  if (error) throw new Error(`gate events query failed: ${error.message}`);
  const now = Date.now();
  const events = ((data ?? []) as Pick<EventRow, 'slug' | 'name' | 'short_name' | 'status' | 'starts_at' | 'event_end'>[])
    .filter((e) => new Date(e.event_end).getTime() > now)
    .map((e) => ({ slug: e.slug, name: e.name, shortName: e.short_name, startsAt: e.starts_at }));
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, { events });
}

// Gate scanner endpoint. Staff-gated. Defense in stages, all but the last
// WITHOUT touching tickets:
//  1. Verify the HMAC locally — a forged code is rejected with no DB hit.
//  2. The token's signed event code must match the station's event, else
//     'wrong_event' (a QR from another show never consumes anything).
//  3. The event must not be over (event_end).
//  4. Only then the atomic validate_ticket RPC flips valid->used in a single
//     statement, so concurrent scans of the same code can't both win.
export default withErrorHandling(async (req: ApiRequest, res: ApiResponse) => {
  if (req.method !== 'POST' && req.method !== 'GET') return methodNotAllowed(res, ['POST', 'GET']);
  if (!isStaff(req)) return sendJson(res, 401, { error: 'unauthorized' });
  if (req.method === 'GET') return listGateEvents(res);

  const body = parseBody<ValidateBody>(req);
  const token = (body.token ?? '').trim();
  const station = (body.station ?? 'gate').slice(0, 64);
  const slug = (body.event ?? '').trim();

  // Stage 1: signature check, no database access. (The /validar login probes
  // with a bogus token: 401 = wrong password, 200 'forged' = logged in.)
  const verified = verifyToken(token);
  if (!verified) {
    return sendJson(res, 200, { result: 'forged' });
  }

  const event = slug ? await getEventBySlug(slug) : null;
  if (!event) return sendJson(res, 400, { error: 'event_required' });

  // Stage 2: QR of another event. Name it so staff can redirect the person.
  if (verified.code !== event.code) {
    const { data: other } = await getSupabase()
      .from('events')
      .select('name')
      .eq('code', verified.code)
      .maybeSingle<{ name: string }>();
    return sendJson(res, 200, closed('wrong_event', { qrEventName: other?.name ?? verified.code }));
  }

  // Stage 3: the gate is frozen once the event is over.
  if (isEventOver(event)) {
    return sendJson(res, 200, closed('event_closed'));
  }

  // Stage 4: atomic claim.
  const { data, error } = await getSupabase()
    .rpc('validate_ticket', { p_ticket_id: verified.ticketId, p_used_by: station })
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
