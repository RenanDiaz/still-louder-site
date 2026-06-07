import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { env } from './env.js';

/** Constant-time comparison that doesn't leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison to keep timing roughly constant.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Reads the gate password from the request. Accepts either an
 * `Authorization: Bearer <password>` header or an `x-access-password` header.
 */
function readPassword(req: VercelRequest): string {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const header = req.headers['x-access-password'];
  if (typeof header === 'string') return header.trim();
  return '';
}

export function isAdmin(req: VercelRequest): boolean {
  const provided = readPassword(req);
  return provided.length > 0 && safeEqual(provided, env.adminPassword);
}

export function isStaff(req: VercelRequest): boolean {
  const provided = readPassword(req);
  if (provided.length === 0) return false;
  // Admins can also operate the gate.
  return safeEqual(provided, env.staffPassword) || safeEqual(provided, env.adminPassword);
}

/** True when the request is an authenticated Vercel Cron invocation. */
export function isCron(req: VercelRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const auth = req.headers['authorization'];
  return typeof auth === 'string' && safeEqual(auth, `Bearer ${secret}`);
}
