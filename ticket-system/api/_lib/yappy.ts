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
