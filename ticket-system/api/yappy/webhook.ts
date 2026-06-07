import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from '../_lib/http.js';
import { issueOrder } from '../_lib/issue.js';

// =============================================================================
// PHASE 2 — Yappy Comercial webhook (stub)
// =============================================================================
// This is the ONLY new code Yappy should require. The issuance routine is
// payment-agnostic (see api/_lib/issue.ts), so a confirmed Yappy payment is
// just another caller of issueOrder() — exactly like the admin "mark paid"
// button. Do NOT add Yappy-specific logic into issuance.
//
// TODO (when Yappy Comercial is approved):
//  1. Verify the webhook signature/HMAC using YAPPY_SECRET_KEY against the raw
//     body (reject anything that doesn't validate — this is the trust boundary).
//  2. Map the Yappy order/transaction reference to our internal orderId
//     (store the Yappy ref in orders.payment_ref when the order is created via
//     the Yappy button flow).
//  3. Only act on a "confirmed/paid" status.
// Endpoints & payloads: yappy.com.pa/comercial/desarrolladores/boton-de-pago-yappy-nueva-integracion/
// =============================================================================

interface YappyWebhookBody {
  orderId?: string;
  status?: string;
  transactionId?: string;
}

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  // Until Yappy is approved and signature verification is wired up, refuse to
  // act. Returning 501 makes it obvious this path is not live yet.
  if (!process.env.YAPPY_SECRET_KEY) {
    return sendJson(res, 501, { error: 'yappy_not_configured' });
  }

  // --- Placeholder for signature verification (see TODO #1) ---
  // const valid = verifyYappySignature(rawBody, req.headers, env.yappySecretKey);
  // if (!valid) return sendJson(res, 401, { error: 'invalid_signature' });

  const body = parseBody<YappyWebhookBody>(req);
  if (!body.orderId || body.status !== 'paid') {
    return sendJson(res, 200, { ignored: true });
  }

  // Same issuance routine as every other payment method.
  await issueOrder(body.orderId, body.transactionId ?? null);
  return sendJson(res, 200, { ok: true });
});
