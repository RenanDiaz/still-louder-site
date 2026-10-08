// =============================================================================
// api/ handler → Cloudflare Workers adapter
// =============================================================================
// The `api/` handlers are written against a Node-style (req, res) pair
// (ApiRequest / ApiResponse in api/_lib/http.ts). This builds that pair from a
// Worker fetch() Request and turns what the handler wrote into a Response.
//
// It implements exactly the surface declared in ApiRequest / ApiResponse.
// Anything new a handler needs (streams, res.write, cookies…) must be added
// to BOTH the types and this adapter.
// =============================================================================

import type { ApiHandler, ApiRequest, ApiResponse } from '../api/_lib/http.js';

// public/_headers only applies to STATIC assets — API responses come from this
// adapter, so the security headers must be set here or /api/* would answer
// without them. Only the document-level directives are needed: the one HTML
// response an API route can return is the admin refund receipt (no inline
// <script>, so script-src 'self' is fine). KEEP IN SYNC with public/_headers.
const API_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; " +
    "form-action 'self'; object-src 'none'"
};


/** Route params (`params`) are merged into req.query. */
export async function runHandler(
  handler: ApiHandler,
  request: Request,
  params: Record<string, string> = {}
): Promise<Response> {
  const url = new URL(request.url);

  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  Object.assign(query, params);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  // Cloudflare terminates the connection; expose the client IP the way the
  // handlers expect it (x-forwarded-for first entry / socket.remoteAddress).
  // ALWAYS overwrite: Cloudflare appends to a client-sent X-Forwarded-For, so
  // its first entry is whatever the client typed (Vercel used to replace it).
  // cf-connecting-ip is set by Cloudflare and can't be spoofed.
  const clientIp = headers['cf-connecting-ip'] ?? '';
  if (clientIp) {
    headers['x-forwarded-for'] = clientIp;
  } else {
    delete headers['x-forwarded-for'];
  }

  // Body parsing: parsed JSON for application/json, raw string otherwise (parseBody() in _lib/http.ts
  // re-parses strings, so an ambiguous content-type still works).
  let body: unknown;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const raw = await request.text();
    if (raw !== '') {
      const contentType = (headers['content-type'] ?? '').split(';')[0].trim();
      if (contentType === 'application/json') {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      } else {
        body = raw;
      }
    }
  }

  const req: ApiRequest = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query,
    body,
    socket: { remoteAddress: clientIp }
  };

  let statusCode = 200;
  const resHeaders = new Headers();
  let responseBody: string | Uint8Array | null = null;
  let finished = false;

  const res: ApiResponse = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    get headersSent() {
      return finished;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      if (Array.isArray(value)) {
        resHeaders.delete(name);
        for (const v of value) resHeaders.append(name, String(v));
      } else {
        resHeaders.set(name, String(value));
      }
      return res;
    },
    getHeader(name: string) {
      return resHeaders.get(name) ?? undefined;
    },
    removeHeader(name: string) {
      resHeaders.delete(name);
    },
    send(payload?: unknown) {
      if (finished) return res;
      if (payload == null) {
        responseBody = null;
      } else if (typeof payload === 'string') {
        responseBody = payload;
      } else if (payload instanceof Uint8Array) {
        // Covers Node Buffers too (Buffer extends Uint8Array).
        responseBody = payload;
      } else {
        if (!resHeaders.has('content-type')) {
          resHeaders.set('content-type', 'application/json; charset=utf-8');
        }
        responseBody = JSON.stringify(payload);
      }
      finished = true;
      return res;
    },
    json(payload: unknown) {
      resHeaders.set('content-type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify(payload));
    },
    end(payload?: string | Uint8Array) {
      if (!finished) {
        if (payload != null) responseBody = payload;
        finished = true;
      }
      return res;
    }
  };

  await handler(req, res);

  // Every api/ handler is wrapped in withErrorHandling() and always responds;
  // this is a belt-and-suspenders guard against a handler that returns without
  // sending.
  if (!finished) {
    statusCode = 500;
    resHeaders.set('content-type', 'application/json; charset=utf-8');
    responseBody = JSON.stringify({ error: 'internal_error' });
  }

  // Never cache API responses unless the handler opted into caching itself
  // (e.g. /api/tickets/qr marks its PNG immutable).
  if (!resHeaders.has('cache-control')) {
    resHeaders.set('cache-control', 'no-store');
  }
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    resHeaders.set(name, value);
  }

  return new Response(responseBody, { status: statusCode, headers: resHeaders });
}
