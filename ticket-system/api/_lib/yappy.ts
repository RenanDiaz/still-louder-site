import crypto from 'node:crypto';
import { env } from './env.js';

// =============================================================================
// Yappy Botón de Pago V2 adapter — server-side only.
// =============================================================================
// Both POSTs (validate merchant + create payment order) run HERE, never in the
// browser: merchantId, the secret key and the session token must not reach the
// client. The frontend only receives {transactionId, token, documentName} to
// feed the <btn-yappy> web component, and payment confirmation only ever comes
// from the IPN (verifyIpnHash) — never from a client-side event.
// =============================================================================

const API_BASE = {
  prod: 'https://apipagosbg.bgeneral.cloud',
  test: 'https://api-comecom-uat.yappycloud.com'
} as const;

// Yappy Comercial / Commerce Integration API (reversals) — a DIFFERENT product
// and host than Botón de Pago V2 above. These base URLs already include `/v1`,
// so the request paths below append `/session/login` and `/transaction/{id}`
// WITHOUT a `/v1` prefix. Override with YAPPY_API_BASE (the env var is what we
// set in Vercel; default to the env-appropriate host so it still works unset).
const REFUND_API_BASE = {
  prod: 'https://api-integration-business.yappy.cloud/v1',
  test: 'https://api-integration-business-uat.yappycloud.com/v1'
} as const;

// The official doc spells the prod CDN two ways (bt-cdn.yappy.cloud in prose,
// bt-cdn.yappycloud.com in the code sample). Default to the prose variant and
// allow YAPPY_BTN_CDN_URL to override once UAT/prod confirms which resolves.
const CDN_URL = {
  prod: 'https://bt-cdn.yappy.cloud/v1/cdn/web-component-btn-yappy.js',
  test: 'https://bt-cdn-uat.yappycloud.com/v1/cdn/web-component-btn-yappy.js'
} as const;

// Per the official error catalog: transient errors worth a retry.
export const RETRYABLE_YAPPY_CODES = new Set(['E002', 'E006', 'E008', 'E012']);

export class YappyError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

/** True when the Yappy button can operate (env vars present). */
export function isYappyConfigured(): boolean {
  return Boolean(process.env.YAPPY_BTN_MERCHANT_ID && process.env.YAPPY_BTN_SECRET_KEY);
}

/**
 * True when the Yappy *transactional* API (used for reversals) has its
 * credentials configured. This is the SEPARATE "Yappy Comercial / Commerce
 * Integration" API, not Botón de Pago V2: it uses a session-login flow keyed by
 * a static api-key + secret-key pair. When unconfigured, the admin can still
 * record a refund manually.
 */
export function isYappyRefundConfigured(): boolean {
  // All three are required: api-key + secret-key are sent as headers and the
  // seed code is the HMAC key used to derive the login `code`. Without the seed
  // the login signature can't be produced, so treat it as not configured (the
  // admin then falls back to a manual refund).
  return Boolean(process.env.YAPPY_API_KEY && process.env.YAPPY_API_SECRET_KEY && process.env.YAPPY_API_SEED);
}

function mode(): 'prod' | 'test' {
  return env.yappyBtnEnv === 'prod' ? 'prod' : 'test';
}

export function yappyCdnUrl(): string {
  return process.env.YAPPY_BTN_CDN_URL || CDN_URL[mode()];
}

interface YappyApiResponse<T> {
  status?: { code?: string; description?: string };
  body?: T;
}

async function yappyPost<T>(path: string, payload: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE[mode()]}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {})
    },
    body: JSON.stringify(payload)
  });

  let json: YappyApiResponse<T> | null = null;
  try {
    json = (await res.json()) as YappyApiResponse<T>;
  } catch {
    // non-JSON body — fall through to the error below
  }

  if (!res.ok || !json?.body) {
    const code = json?.status?.code ?? `HTTP_${res.status}`;
    const description = json?.status?.description ?? 'Yappy request failed';
    throw new YappyError(code, `${path}: ${description}`);
  }
  return json.body;
}

/** Call 1 — POST /payments/validate/merchant. Returns the session token for call 2. */
export async function validateMerchant(): Promise<string> {
  const body = await yappyPost<{ token?: string; epochTime?: number }>('/payments/validate/merchant', {
    merchantId: env.yappyBtnMerchantId,
    urlDomain: env.yappyBtnDomain
  });
  if (!body.token) {
    throw new YappyError('E100', 'validate/merchant returned no token');
  }
  return body.token;
}

export interface YappyPaymentSession {
  transactionId: string;
  token: string;
  documentName: string;
}

/**
 * Call 2 — POST /payments/payment-wc. Creates the payment order on Yappy's side
 * and returns the trio the web component needs to launch the charge.
 * `orderRef` is our short ref (<= 15 alphanumeric chars), NEVER the UUID.
 */
export async function createYappyPaymentOrder(opts: {
  sessionToken: string;
  orderRef: string;
  totalCents: number;
  aliasYappy?: string | null;
}): Promise<YappyPaymentSession> {
  const amount = (opts.totalCents / 100).toFixed(2);
  const body = await yappyPost<Partial<YappyPaymentSession>>(
    '/payments/payment-wc',
    {
      merchantId: env.yappyBtnMerchantId,
      orderId: opts.orderRef,
      domain: env.yappyBtnDomain,
      // Epoch in seconds. The doc doesn't pin the unit — if UAT rejects the
      // date, switch to Date.now() (milliseconds). (Spec §12.3)
      paymentDate: Math.floor(Date.now() / 1000),
      // Panamanian phone without prefix. Required in UAT (test user's phone);
      // omitted when unknown — prod behavior pending confirmation (spec §12.1).
      ...(opts.aliasYappy ? { aliasYappy: opts.aliasYappy } : {}),
      ipnUrl: `${env.publicBaseUrl}/api/yappy/ipn`,
      discount: '0.00',
      taxes: '0.00',
      subtotal: amount,
      total: amount
    },
    opts.sessionToken
  );
  if (!body.transactionId || !body.token || !body.documentName) {
    throw new YappyError('E100', 'payment-wc returned an incomplete body');
  }
  return body as YappyPaymentSession;
}

// --- Yappy Comercial transactional API (reversals) ---------------------------
// Distinct from Botón de Pago V2 above. Two steps: open a session (login) to get
// a bearer token, then PUT the reversal. Base URL comes from YAPPY_API_BASE
// (which already includes `/v1`); when unset, defaults to the env-appropriate
// Yappy Comercial host. We strip any trailing slash so the paths below join
// cleanly as `${base}/session/login` and `${base}/transaction/{id}`.

function refundApiBase(): string {
  return (process.env.YAPPY_API_BASE || REFUND_API_BASE[mode()]).replace(/\/+$/, '');
}

/** Today's date as YYYY-MM-DD in Panama time (the login code is date-scoped). */
function panamaDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; America/Panama is UTC-5 (no DST). The reversal
  // window is "same day before midnight", so the date is computed in Panama
  // local time. (If UAT shows a midnight-boundary mismatch, Yappy may key the
  // code on UTC instead — confirm with support.)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Panama',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/**
 * Login `code` per the integration manual: HMAC-SHA256 of the message
 * (apiKey + date YYYY-MM-DD) keyed with the **Seed Code**, hex-encoded. The
 * Seed Code — NOT the secret key — is the HMAC key; the secret key is only ever
 * sent as the `secret-key` header. Verified against the manual's worked example
 * (see the self-test below).
 */
function loginCode(apiKey: string, date: string, seed: string): string {
  return crypto.createHmac('sha256', seed).update(`${apiKey}${date}`).digest('hex');
}

function sessionCode(): string {
  return loginCode(env.yappyApiKey, panamaDate(), env.yappyApiSeed);
}

// Sanity-check the login-code algorithm against the manual's worked example at
// module load, so a regression (wrong key, wrong subject) surfaces here instead
// of only as a live 403 from Yappy.
{
  const expected = 'f957f8b8f9664832e6051e3389864682624a8e2b9aaf4dd80fb2aaea7af58940';
  const got = loginCode('30170525-6ba7-4606-98e3-1391f38662d3', '2025-07-07', 'UKEUY-90122904');
  if (got !== expected) {
    console.error('[yappy] login-code HMAC self-test FAILED — sessionCode() is broken');
  }
}

/**
 * POST {base}/session/login — opens a Yappy Comercial session and returns the
 * bearer token used to authorize the reversal. The request body is wrapped in
 * { body: { code } } per the spec (the seed is NOT in the body — it's only the
 * HMAC key). The token may come back either as a string or as { token }
 * depending on the environment, so we accept both.
 */
async function openRefundSession(): Promise<string> {
  const url = `${refundApiBase()}/session/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.yappyApiKey,
      'secret-key': env.yappyApiSecretKey
    },
    body: JSON.stringify({ body: { code: sessionCode() } })
  });

  type LoginResponse = { status?: { code?: string; description?: string }; body?: { token?: unknown } };
  let json: LoginResponse | null = null;
  try {
    json = (await res.json()) as LoginResponse;
  } catch {
    // fall through to the code/description defaults below
  }

  const code = json?.status?.code ?? `HTTP_${res.status}`;
  // TEMP diagnostics (Vercel Logs → filter /api/admin): which step failed and how.
  console.error(`[yappy] session/login url=${url} httpStatus=${res.status} code=${code}`);
  if (code !== 'YP-0000') {
    throw new YappyError(code, `session/login: ${json?.status?.description ?? 'login failed'}`);
  }
  const tokenField = json?.body?.token;
  const token =
    typeof tokenField === 'string'
      ? tokenField
      : ((tokenField as { token?: string } | undefined)?.token ?? '');
  if (!token) throw new YappyError('E100', 'session/login returned no token');
  return token;
}

/**
 * Reverse (refund) a same-day Yappy transaction. Logs in for a session token,
 * then PUT {base}/transaction/{id}. Per the manual this only works while the
 * charge is still "en tránsito" (EXECUTED, not yet accredited); once settled
 * (COMPLETED) Yappy returns YP-0014 and the refund must be handled out-of-band.
 * transactionId is what payment-wc returned (stored in orders.yappy_transaction_id).
 *
 * Returns the status pair on success (YP-0000, or YP-0016 already reversed);
 * throws YappyError with Yappy's code (e.g. YP-0014 out of window) otherwise.
 */
export async function reverseYappyPayment(
  transactionId: string,
  clientIp: string
): Promise<{ code: string; description: string }> {
  const token = await openRefundSession();

  const url = `${refundApiBase()}/transaction/${encodeURIComponent(transactionId)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'api-key': env.yappyApiKey,
      'secret-key': env.yappyApiSecretKey,
      // `channel` and the client IP are the "cabeceras obligatorias" — a missing
      // one yields YP-0008. NOTE: clientIp here is the admin browser's IP (from
      // x-forwarded-for); confirm with Yappy whether the IP header must instead
      // be the merchant server's egress IP and the exact header name.
      'client-ip': clientIp,
      channel: env.yappyApiChannel
    }
  });

  let json: YappyApiResponse<unknown> | null = null;
  try {
    json = (await res.json()) as YappyApiResponse<unknown>;
  } catch {
    // non-JSON body — fall through to the code/description defaults below
  }

  const code = json?.status?.code ?? `HTTP_${res.status}`;
  const description = json?.status?.description ?? 'Yappy reversal failed';
  // TEMP diagnostics (Vercel Logs → filter /api/admin): which step failed and how.
  console.error(`[yappy] transaction PUT url=${url} httpStatus=${res.status} code=${code}`);
  // YP-0000 = reversed. YP-0016 = already reversed: treat as idempotent success
  // (the money is back regardless). Everything else (YP-0014 already settled /
  // out of window, YP-0013, YP-0008 missing headers, YP-0002, YP-9999, HTTP_*)
  // is a failure the caller surfaces so the admin can fall back to a manual refund.
  if (code !== 'YP-0000' && code !== 'YP-0016') {
    throw new YappyError(code, `reverse ${transactionId}: ${description}`);
  }
  return { code, description };
}

/**
 * IPN hash check — the trust boundary for payment confirmation.
 * The secret (base64) decodes to "<hmacKey>.<...>"; the first dot-segment is
 * the HMAC-SHA256 key and the signed message is orderId + status + domain.
 * Note the amount is NOT part of the hash: the amount was fixed server-side at
 * payment-wc time, so the IPN is only trusted for the authenticated status
 * transition, never for money math.
 */
export function verifyIpnHash(params: {
  orderId: string;
  status: string;
  domain: string;
  hash: string;
}): boolean {
  const decoded = Buffer.from(env.yappyBtnSecretKey, 'base64').toString('utf8');
  const key = decoded.split('.')[0];
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${params.orderId}${params.status}${params.domain}`)
    .digest('hex');
  const received = Buffer.from(params.hash || '', 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return received.length === wanted.length && crypto.timingSafeEqual(received, wanted);
}
