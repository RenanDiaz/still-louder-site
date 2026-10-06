// GA4 for the PUBLIC surfaces only (/entradas, /halloween-party, /ayuda) —
// spec: docs/features/analytics-entradas.md. Same property as the main site;
// the `_ga` cookie lives on .still-louder.com so both share the client_id.
//
// Loaded from this module (not an inline <script>) because the CSP has no
// 'unsafe-inline'. Everything here is a no-op off the production host or when
// gtag.js is blocked, and nothing ever throws: analytics can't break a sale.
// Never pass PII (name, email, phone, QR tokens) to track().
//
// The `purchase` event is NOT sent from here: the server sends it when the
// order is paid (api/_lib/ga.ts), using the ids from getGaIds().

import { GA_MEASUREMENT_ID } from './config';

const PROD_HOST = 'entradas.still-louder.com';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export interface GaIds {
  clientId: string;
  sessionId: string | null;
}

let enabled = false;
let context: Record<string, string> = {};
let idsPromise: Promise<GaIds | null> = Promise.resolve(null);

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

function gtagGet(field: 'client_id' | 'session_id'): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      window.gtag!('get', GA_MEASUREMENT_ID, field, (value: unknown) =>
        resolve(value === undefined || value === null ? null : String(value))
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Loads gtag.js. The page_view is NOT sent automatically: each surface calls
 * trackPageView() once it knows the event, so the hit carries event_slug.
 */
export function initAnalytics(): void {
  if (enabled || window.location.hostname !== PROD_HOST) return;
  try {
    enabled = true;
    window.dataLayer = window.dataLayer || [];
    // gtag.js needs the `arguments` object itself, not an array.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    const config: Record<string, unknown> = { send_page_view: false };
    // debug_mode: false still enables debugging, so only set it when asked.
    if (new URLSearchParams(window.location.search).get('debug_mode') === '1') config.debug_mode = true;
    window.gtag('config', GA_MEASUREMENT_ID, config);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    // Resolved once gtag.js runs; never if it's blocked (hence the timeout).
    idsPromise = withTimeout(
      Promise.all([gtagGet('client_id'), gtagGet('session_id')]).then(([clientId, sessionId]) =>
        clientId ? { clientId, sessionId } : null
      ),
      5000,
      null
    );
  } catch {
    enabled = false;
  }
}

export function track(name: string, params: Record<string, unknown> = {}): void {
  if (!enabled) return;
  try {
    window.gtag!('event', name, { ...context, ...params });
  } catch {
    // ignore
  }
}

/**
 * Params merged into every later track() call (event_slug, event_status).
 * Not gtag('set'): in production its custom params never reached the hits.
 */
export function setAnalyticsContext(params: Record<string, string>): void {
  context = { ...context, ...params };
}

export function trackPageView(params: Record<string, unknown> = {}): void {
  track('page_view', params);
}

/** GA ids of this browser for order attribution; null when unavailable. Waits ≤ 500 ms. */
export function getGaIds(): Promise<GaIds | null> {
  if (!enabled) return Promise.resolve(null);
  return withTimeout(idsPromise, 500, null);
}
