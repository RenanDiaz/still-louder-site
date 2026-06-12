import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../_lib/supabase.js';
import { methodNotAllowed, sendJson, withErrorHandling } from '../../_lib/http.js';
import { makeToken } from '../../_lib/hmac.js';
import { buildWalletSaveUrl, isGoogleWalletConfigured } from '../../_lib/google-wallet.js';

// =============================================================================
// GET /api/wallet/google/:ticketId — on-demand "Add to Google Wallet" link.
// =============================================================================
// Alternative to the button embedded in the confirmation email (e.g. for the
// success page). Scoped to the ticket: knowing its UUID is the capability, the
// same model as /api/orders/:id/status. The pass barcode is the ticket's own
// signed HMAC token, so legitimacy is enforced at the door regardless of who
// fetches this — nothing secret is exposed.
//
// Default: 302 redirect to the pay.google.com save URL. With ?format=json it
// returns { saveUrl } instead (handy for rendering a button client-side).
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TicketRow {
  id: string;
  tier: string;
  status: string;
  orders: { id: string; buyer_name: string } | null;
}

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!isGoogleWalletConfigured()) return sendJson(res, 404, { error: 'not_available' });

  const ticketId = typeof req.query.ticketId === 'string' ? req.query.ticketId : '';
  if (!UUID_RE.test(ticketId)) return sendJson(res, 400, { error: 'invalid_ticket_id' });

  const { data, error } = await getSupabase()
    .from('tickets')
    .select('id, tier, status, orders!inner(id, buyer_name)')
    .eq('id', ticketId)
    .maybeSingle<TicketRow>();
  if (error) throw new Error(`wallet ticket lookup failed: ${error.message}`);
  if (!data) return sendJson(res, 404, { error: 'ticket_not_found' });
  // Revoked tickets won't pass the gate, so don't hand out a Wallet pass for one.
  if (data.status === 'void') return sendJson(res, 410, { error: 'ticket_void' });

  const saveUrl = buildWalletSaveUrl({
    token: makeToken(data.id),
    buyerName: data.orders?.buyer_name ?? '',
    tier: data.tier,
    ticketNumber: (data.orders?.id ?? data.id).slice(0, 8).toUpperCase()
  });
  if (!saveUrl) return sendJson(res, 500, { error: 'wallet_url_failed' });

  const format = typeof req.query.format === 'string' ? req.query.format : '';
  if (format === 'json') {
    return sendJson(res, 200, { saveUrl });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', saveUrl);
  res.end();
});
