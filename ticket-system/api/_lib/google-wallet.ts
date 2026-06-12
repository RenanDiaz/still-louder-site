import { createSign } from 'node:crypto';
import { env } from './env.js';
import { verifyToken } from './hmac.js';

// =============================================================================
// Google Wallet — "Add to Google Wallet" for WWWY3 event tickets.
// =============================================================================
// Everything here is SERVER-ONLY. The service-account private key signs an
// RS256 JWT and NEVER reaches the browser (nothing in api/_lib is importable by
// src/). The pass barcode reuses the SAME signed HMAC token that already prints
// in the email, so the gate scanner accepts a Wallet pass byte-for-byte like a
// printed/emailed QR. Google Wallet does not vouch for the ticket — the HMAC
// signature does (validated at the door); Wallet is only a nicer container.
//
// Two responsibilities:
//   1. buildWalletSaveUrl()       — pure crypto, no network. Builds the
//      eventTicketObject inline, signs the save JWT, returns the pay.google.com
//      save link. Used during issuance (email) and by the on-demand endpoint.
//   2. ensureEventTicketClass()   — idempotent network call (admin-triggered)
//      that creates the event's Passes Class once via the Wallet REST API.
// =============================================================================

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';

// Event facts mirror the confirmation email (which hardcodes "1 de agosto" /
// "Hops"). Kept here as constants so the class metadata stays in one place;
// adjust the address / start time here if the venue details firm up.
const EVENT_NAME = 'When We Were Young 3 (WWWY3)';
const VENUE_NAME = 'Hops';
const VENUE_ADDRESS = 'Hops, Ciudad de Panamá, Panamá';
const EVENT_START_ISO = '2026-08-01T20:00:00-05:00';
const BACKGROUND_HEX = '#3e2768';

const TIER_LABEL: Record<string, string> = {
  preventa: 'Preventa',
  general: 'General',
  cortesia: 'Cortesía'
};

/** True only when the three required secrets are present. */
export function isGoogleWalletConfigured(): boolean {
  return Boolean(env.googleWalletIssuerId && env.googleWalletSaEmail && env.googleWalletSaPrivateKey);
}

function getClassId(): string {
  return `${env.googleWalletIssuerId}.${env.googleWalletClassSuffix}`;
}

function getObjectId(ticketId: string): string {
  // ticketId is a UUID (hex + hyphens) — already within the [A-Za-z0-9._-]
  // charset Google requires for object ids.
  return `${env.googleWalletIssuerId}.${ticketId}`;
}

// Normaliza la clave privada tal cual quedó guardada en el entorno hacia un PEM
// válido. OpenSSL 3 (Node 18+) rechaza con ERR_OSSL_UNSUPPORTED cualquier byte
// que no decodifique, así que toleramos las dos formas más comunes en que la
// clave de una service account se corrompe al pegarla en Vercel:
//   1. saltos de línea escapados como los caracteres literales "\n" (o "\r\n"),
//   2. comillas envolventes copiadas junto con el valor de `private_key` del
//      JSON de la service account.
function privateKeyPem(): string {
  let key = env.googleWalletSaPrivateKey.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/\\r/g, '').replace(/\\n/g, '\n');
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

// Minimal RS256 JWT — no dependency needed; node:crypto signs the PEM directly.
function signRs256(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(privateKeyPem()));
  return `${signingInput}.${signature}`;
}

export interface WalletTicketInput {
  // The signed HMAC token (WWWY3.<ticketId>.<sig>) — reused verbatim as the
  // pass barcode. The ticket id is derived from it.
  token: string;
  buyerName: string;
  tier: string;
  // Human-readable number shown on the pass (e.g. "A1B2C3D4-1").
  ticketNumber?: string;
}

/**
 * Builds the pay.google.com save URL for one ticket. Pure crypto, no network.
 * Returns null when Wallet isn't configured or the token is invalid, and never
 * throws — so a misconfigured key degrades to "no button", never a broken
 * email or a blocked issuance.
 */
export function buildWalletSaveUrl(input: WalletTicketInput): string | null {
  if (!isGoogleWalletConfigured()) return null;
  const ticketId = verifyToken(input.token);
  if (!ticketId) return null;

  try {
    const eventTicketObject = {
      id: getObjectId(ticketId),
      classId: getClassId(),
      state: 'ACTIVE',
      barcode: { type: 'QR_CODE', value: input.token },
      ticketHolderName: input.buyerName,
      ticketNumber: input.ticketNumber ?? ticketId,
      ticketType: {
        defaultValue: { language: 'es', value: TIER_LABEL[input.tier] ?? input.tier }
      }
    };

    // The class is referenced by classId only (it must already exist via
    // ensureEventTicketClass) so the JWT — and therefore the URL — stays short.
    const claims = {
      iss: env.googleWalletSaEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [env.publicBaseUrl],
      payload: { eventTicketObjects: [eventTicketObject] }
    };

    return `https://pay.google.com/gp/v/save/${signRs256(claims)}`;
  } catch (err) {
    console.error('[google-wallet] failed to build save url', err instanceof Error ? err.message : err);
    return null;
  }
}

// --- Class creation (admin-triggered, idempotent) -----------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;

// Mints an OAuth2 access token for the Wallet API via the JWT-bearer grant
// (self-signed by the service account). Cached until shortly before expiry.
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.value;
  }

  const assertion = signRs256({
    iss: env.googleWalletSaEmail,
    scope: WALLET_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`wallet oauth failed (${res.status}): ${data.error_description ?? 'no access_token'}`);
  }

  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

function buildEventTicketClass(classId: string) {
  return {
    id: classId,
    issuerName: 'Still Louder',
    // UNDER_REVIEW works in demo mode; flip to APPROVED once Google grants
    // publishing access.
    reviewStatus: 'UNDER_REVIEW',
    eventName: { defaultValue: { language: 'es', value: EVENT_NAME } },
    venue: {
      name: { defaultValue: { language: 'es', value: VENUE_NAME } },
      address: { defaultValue: { language: 'es', value: VENUE_ADDRESS } }
    },
    dateTime: { start: EVENT_START_ISO },
    // Logo / hero must be HTTPS, no redirects — served from this app's own
    // public/ dir (same Vercel deployment as the API).
    logo: { sourceUri: { uri: `${env.publicBaseUrl}/apple-touch-icon.png` } },
    heroImage: { sourceUri: { uri: `${env.publicBaseUrl}/og-image.jpg` } },
    hexBackgroundColor: BACKGROUND_HEX
  };
}

export interface EnsureClassResult {
  classId: string;
  created: boolean;
}

/**
 * Creates the event's Passes Class if it doesn't already exist. Idempotent:
 * a GET that returns 200 means the class is there and nothing is recreated.
 * Throws on real API errors so the admin sees them.
 */
export async function ensureEventTicketClass(): Promise<EnsureClassResult> {
  const classId = getClassId();
  const accessToken = await getAccessToken();

  const getRes = await fetch(`${WALLET_API}/eventTicketClass/${encodeURIComponent(classId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (getRes.ok) {
    return { classId, created: false };
  }
  if (getRes.status !== 404) {
    const detail = await getRes.text().catch(() => '');
    throw new Error(`wallet class lookup failed (${getRes.status}): ${detail.slice(0, 300)}`);
  }

  const postRes = await fetch(`${WALLET_API}/eventTicketClass`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildEventTicketClass(classId))
  });
  if (!postRes.ok) {
    const detail = await postRes.text().catch(() => '');
    throw new Error(`wallet class create failed (${postRes.status}): ${detail.slice(0, 300)}`);
  }

  return { classId, created: true };
}
