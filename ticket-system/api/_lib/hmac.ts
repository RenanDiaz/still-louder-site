import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

// QR payload format: WWWY3.<ticket_id>.<sig>
// sig = first 16 bytes (32 hex chars) of HMAC_SHA256(ticket_id, secret).
// The signature is what makes counterfeit tickets impossible: without the
// secret you cannot produce a valid <sig> for any ticket id.
const PREFIX = 'WWWY3';
const SIG_HEX_LEN = 32; // 16 bytes

function sign(ticketId: string): string {
  return createHmac('sha256', env.ticketHmacSecret)
    .update(ticketId)
    .digest('hex')
    .slice(0, SIG_HEX_LEN);
}

export function makeToken(ticketId: string): string {
  return `${PREFIX}.${ticketId}.${sign(ticketId)}`;
}

/**
 * Verifies a scanned token WITHOUT touching the database. Returns the ticket id
 * only when the signature is cryptographically valid; otherwise null. Callers
 * must treat null as an immediate rejection (forged / corrupt code).
 */
export function verifyToken(token: string): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [prefix, ticketId, sig] = parts;
  if (prefix !== PREFIX || !ticketId || !sig) return null;

  const expected = sign(ticketId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return ticketId;
}
