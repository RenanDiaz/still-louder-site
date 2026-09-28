import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { EVENT_CODE_RE } from './events.js';

// QR payload format: <CODE>.<ticket_id>.<sig>
//   CODE = events.code ([A-Z0-9]{3,8}, e.g. WWWY3, SL3110)
//   sig  = first 16 bytes (32 hex chars) of HMAC_SHA256(`${CODE}.${ticket_id}`, secret)
// The signature covers the event code, so a QR declares its event BEFORE any DB
// access and a token cannot be re-labelled for another show. The secret does
// NOT need rotating per event. Tokens minted before migration 0011 (signed over
// the bare ticket id) no longer verify — resending the email re-mints them.
const SIG_HEX_LEN = 32; // 16 bytes

function sign(code: string, ticketId: string): string {
  return createHmac('sha256', env.ticketHmacSecret)
    .update(`${code}.${ticketId}`)
    .digest('hex')
    .slice(0, SIG_HEX_LEN);
}

export function makeToken(code: string, ticketId: string): string {
  return `${code}.${ticketId}.${sign(code, ticketId)}`;
}

export interface VerifiedToken {
  code: string;
  ticketId: string;
}

/**
 * Verifies a scanned token WITHOUT touching the database. Returns the event
 * code + ticket id only when the signature is cryptographically valid;
 * otherwise null. Callers must treat null as an immediate rejection (forged).
 */
export function verifyToken(token: string): VerifiedToken | null {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [code, ticketId, sig] = parts;
  if (!EVENT_CODE_RE.test(code) || !ticketId || !sig) return null;

  const expected = sign(code, ticketId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { code, ticketId };
}
