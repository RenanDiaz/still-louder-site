// =============================================================================
// Cloudflare Worker entry for the ticket system (entradas.still-louder.com)
// =============================================================================
// Routes /api/* to the handlers under api/ (through cloudflare/adapter.ts)
// and serves the Vite build in dist/ as static assets for everything else.
// There is no filesystem routing: A NEW FILE UNDER api/ MUST BE REGISTERED
// HERE or it will 404. Page rewrites/redirects live in public/_redirects.
//
// The daily cleanup cron is the scheduled() handler below + the
// "triggers.crons" entry in wrangler.jsonc.
// =============================================================================

import type { ApiHandler } from '../api/_lib/http.js';
import { runHandler } from './adapter.js';

import adminHandler from '../api/admin.js';
import giftsHandler from '../api/gifts.js';
import ordersHandler from '../api/orders.js';
import orderStatusHandler from '../api/orders/[id]/status.js';
import presaleStatusHandler from '../api/presale/status.js';
import ticketsQrHandler from '../api/tickets/qr.js';
import ticketsValidateHandler from '../api/tickets/validate.js';
import walletGoogleHandler from '../api/wallet/google/[ticketId].js';
import yappyConfigHandler from '../api/yappy/config.js';
import yappyCreateOrderHandler from '../api/yappy/create-order.js';
import yappyIpnHandler from '../api/yappy/ipn.js';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CRON_SECRET?: string;
}

const FIXED_ROUTES: Record<string, ApiHandler> = {
  '/api/gifts': giftsHandler,
  '/api/orders': ordersHandler,
  '/api/presale/status': presaleStatusHandler,
  '/api/tickets/qr': ticketsQrHandler,
  '/api/tickets/validate': ticketsValidateHandler,
  '/api/yappy/config': yappyConfigHandler,
  '/api/yappy/create-order': yappyCreateOrderHandler,
  '/api/yappy/ipn': yappyIpnHandler
};

const ORDER_STATUS_RE = /^\/api\/orders\/([^/]+)\/status$/;
const WALLET_GOOGLE_RE = /^\/api\/wallet\/google\/([^/]+)$/;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function handleApi(request: Request, pathname: string): Promise<Response> {
  const fixed = FIXED_ROUTES[pathname];
  if (fixed) return runHandler(fixed, request);

  // /api/admin/<sub/path> — every admin route lives in api/admin.ts, which
  // dispatches on req.query.path; the router passes the sub-path as that
  // route param.
  if (pathname === '/api/admin') return runHandler(adminHandler, request);
  if (pathname.startsWith('/api/admin/')) {
    const sub = pathname.slice('/api/admin/'.length);
    return runHandler(adminHandler, request, { path: sub });
  }

  const orderStatus = pathname.match(ORDER_STATUS_RE);
  if (orderStatus) {
    return runHandler(orderStatusHandler, request, { id: orderStatus[1] });
  }

  const walletGoogle = pathname.match(WALLET_GOOGLE_RE);
  if (walletGoogle) {
    return runHandler(walletGoogleHandler, request, { ticketId: walletGoogle[1] });
  }

  return jsonResponse(404, { error: 'not_found' });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Normalize the trailing slash so /api/orders/ matches too (the static
    // side gets the same treatment from html_handling).
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, pathname);
      } catch (err) {
        // withErrorHandling() already catches handler errors; this catches
        // adapter/env failures (e.g. a missing required env var).
        console.error('[worker] unhandled api error', err);
        return jsonResponse(500, { error: 'internal_error' });
      }
    }

    // Everything else is a static asset (with run_worker_first scoped to
    // /api/*, most asset requests never even reach this Worker).
    return env.ASSETS.fetch(request);
  },

  // Daily cron: cancel expired pending reservations. Authenticated like any
  // cron call to the admin route — `Authorization: Bearer CRON_SECRET`, see
  // isCron() in api/_lib/auth.ts.
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const secret = env.CRON_SECRET ?? process.env.CRON_SECRET ?? '';
    if (!secret) {
      console.error('[cron] CRON_SECRET is not set; skipping orders cleanup');
      return;
    }
    const request = new Request('https://cron.internal/api/admin?path=orders/cleanup', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` }
    });
    const response = await runHandler(adminHandler, request, { path: 'orders/cleanup' });
    if (!response.ok) {
      console.error('[cron] orders cleanup failed', response.status, await response.text());
    }
  }
};
