import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from './_lib/supabase.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from './_lib/http.js';
import { issueOrder } from './_lib/issue.js';
import type { ClaimGiftRow, GiftCampaignStatus } from './_lib/types.js';

// Public endpoint for the hidden gift campaigns (/regalo/<token>). One function
// dispatching by method (Vercel Hobby caps a deployment at 12 functions):
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

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd ?? '';
  // x-forwarded-for is a comma-separated list; the client is the first entry.
  return raw.split(',')[0].trim() || (req.socket?.remoteAddress ?? '');
}

async function getCampaignStatus(req: VercelRequest, res: VercelResponse): Promise<void> {
  const raw = req.query.token;
  const token = (Array.isArray(raw) ? raw[0] : raw ?? '').trim();
  // Neutral 404 for missing/unknown token — never reveal whether a campaign exists.
  if (!token) return sendJson(res, 404, { error: 'not_found' });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('gift_campaign')
    .select('status')
    .eq('token', token)
    .maybeSingle<{ status: GiftCampaignStatus }>();
  if (error) throw new Error(`gift campaign lookup failed: ${error.message}`);
  if (!data) return sendJson(res, 404, { error: 'not_found' });

  // Only expose the status — never claimed_count/max_gifts.
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, { status: data.status });
}

interface ClaimBody {
  token?: string;
  name?: string;
  email?: string;
  phone?: string;
}

async function claimGift(req: VercelRequest, res: VercelResponse): Promise<void> {
  const body = parseBody<ClaimBody>(req);
  const token = (body.token ?? '').trim();
  const name = (body.name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const phone = (body.phone ?? '').trim() || null;

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
    // Reuse the shared, idempotent issuance pipeline: marks the $0 order paid,
    // creates the ticket, and sends the signed-QR email (Resend + Google Wallet).
    const result = await issueOrder(data.order_id);
    return sendJson(res, 201, { status: 'claimed', emailed: result.emailed });
  }

  // Defensive: unexpected status.
  throw new Error(`claim_gift returned unexpected status: ${String(status)}`);
}

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method === 'GET') return getCampaignStatus(req, res);
  if (req.method === 'POST') return claimGift(req, res);
  return methodNotAllowed(res, ['GET', 'POST']);
});
