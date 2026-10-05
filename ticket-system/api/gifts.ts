import { getSupabase } from './_lib/supabase.js';
import {
  type ApiRequest,
  type ApiResponse,
  methodNotAllowed,
  parseBody,
  sendJson,
  withErrorHandling
} from './_lib/http.js';
import { haveSalesEnded, type EventRow } from './_lib/events.js';
import { issueOrder } from './_lib/issue.js';
import type { ClaimGiftRow, GiftCampaignStatus } from './_lib/types.js';

// Public endpoint for the hidden gift campaigns (/regalo/<token>). One handler
// dispatching by method:
//
//   GET  /api/gifts?token=...   campaign status, to render the hidden page
//   POST /api/gifts             claim a gift (token + name/email/phone in body)
//
// Security model: the token is a long unguessable secret (the URL is the QR).
// An invalid/unknown token gets a neutral 404 so the existence of campaigns is
// never leaked. PII (name/email/phone) only travels in the POST body, never in
// a query string. The first N successful claims per campaign get a ticket; the
// "still room / no room" decision is made atomically in the claim_gift RPC.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Soft anti-abuse: a single IP may create at most this many claims within the
// window (across all campaigns). The unguessable token and unique(email) are
// the primary defenses; this only blunts scripted hammering.
const IP_WINDOW_MS = 60_000;
const IP_MAX_CLAIMS = 5;

function clientIp(req: ApiRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd ?? '';
  // x-forwarded-for is a comma-separated list; the client is the first entry.
  return raw.split(',')[0].trim() || (req.socket?.remoteAddress ?? '');
}

async function getCampaignStatus(req: ApiRequest, res: ApiResponse): Promise<void> {
  const raw = req.query.token;
  const token = (Array.isArray(raw) ? raw[0] : raw ?? '').trim();
  // Neutral 404 for missing/unknown token — never reveal whether a campaign exists.
  if (!token) return sendJson(res, 404, { error: 'not_found' });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('gift_campaign')
    .select('status, events!inner(*)')
    .eq('token', token)
    .maybeSingle<{ status: GiftCampaignStatus; events: EventRow | null }>();
  if (error) throw new Error(`gift campaign lookup failed: ${error.message}`);
  if (!data || !data.events) return sendJson(res, 404, { error: 'not_found' });
  const event = data.events;
  // El evento de la campaña ya pasó (o no está a la venta): el 404 neutral es
  // el mismo que para un token inválido, así que un QR de campaña que siga
  // circulando impreso no revela nada — solo deja de dar boletos.
  if (event.status !== 'on_sale' || haveSalesEnded(event)) {
    return sendJson(res, 404, { error: 'not_found' });
  }

  // Only expose the status and the event's public copy — never
  // claimed_count/max_gifts.
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, {
    status: data.status,
    event: {
      slug: event.slug,
      name: event.name,
      shortName: event.short_name,
      venue: event.venue,
      startsAt: event.starts_at,
      theme: event.theme
    }
  });
}

interface ClaimBody {
  token?: string;
  name?: string;
  email?: string;
  phone?: string;
  // "Quiero recibir noticias" checkbox; only a literal `true` counts as consent.
  marketing_opt_in?: boolean;
}

async function claimGift(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = parseBody<ClaimBody>(req);
  const token = (body.token ?? '').trim();
  const name = (body.name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const phone = (body.phone ?? '').trim() || null;

  // (Evento terminado / fuera de venta → claim_gift responde 'closed', el mismo
  // código que una campaña desactivada, así que el cliente lo maneja tal cual.)
  if (!token) return sendJson(res, 404, { error: 'not_found' });
  if (name.length < 2) return sendJson(res, 400, { error: 'invalid_name' });
  if (!EMAIL_RE.test(email)) return sendJson(res, 400, { error: 'invalid_email' });

  const supabase = getSupabase();
  const ip = clientIp(req);

  // Soft per-IP throttle (best-effort; serverless has no shared memory so this
  // is a DB count over a short window).
  if (ip) {
    const since = new Date(Date.now() - IP_WINDOW_MS).toISOString();
    const { count } = await supabase
      .from('gift_claim')
      .select('id', { count: 'exact', head: true })
      .eq('claimer_ip', ip)
      .gte('created_at', since);
    if ((count ?? 0) >= IP_MAX_CLAIMS) {
      return sendJson(res, 429, { error: 'rate_limited' });
    }
  }

  const { data, error } = await supabase
    .rpc('claim_gift', {
      p_token: token,
      p_name: name,
      p_email: email,
      p_phone: phone,
      p_ip: ip || null
    })
    .single<ClaimGiftRow>();
  if (error) throw new Error(`claim_gift failed: ${error.message}`);

  // Non-success outcomes go in `error` so the shared client `request` helper
  // surfaces them as the thrown error's `.code` for friendly copy.
  const status = data?.status;
  if (status === 'not_found') return sendJson(res, 404, { error: 'not_found' });
  if (status === 'closed') return sendJson(res, 409, { error: 'closed' });
  if (status === 'exhausted') return sendJson(res, 409, { error: 'exhausted' });
  if (status === 'already_claimed') return sendJson(res, 409, { error: 'already_claimed' });

  if (status === 'claimed' && data?.order_id) {
    // Opt-in de noticias (migración 0015). Best-effort, antes de emitir para
    // que la orden ya lo tenga; un fallo deja false (la dirección segura).
    if (body.marketing_opt_in === true) {
      const { error: optInError } = await supabase
        .from('orders')
        .update({ marketing_opt_in: true, marketing_opt_in_at: new Date().toISOString() })
        .eq('id', data.order_id);
      if (optInError) console.error('[gifts] marketing opt-in update failed', optInError);
    }
    // Reuse the shared, idempotent issuance pipeline: marks the $0 order paid,
    // creates the ticket, and sends the signed-QR email (Resend + Google Wallet).
    const result = await issueOrder(data.order_id);
    return sendJson(res, 201, { status: 'claimed', emailed: result.emailed });
  }

  // Defensive: unexpected status.
  throw new Error(`claim_gift returned unexpected status: ${String(status)}`);
}

export default withErrorHandling(async (req: ApiRequest, res: ApiResponse) => {
  if (req.method === 'GET') return getCampaignStatus(req, res);
  if (req.method === 'POST') return claimGift(req, res);
  return methodNotAllowed(res, ['GET', 'POST']);
});
