// =============================================================================
// Vercel → Cloudflare Workers adapter
// =============================================================================
// Runs the existing `api/` handlers — written against Vercel's (req, res)
// Node-style interface — inside a Cloudflare Worker's fetch()-style runtime,
// so the SAME backend code deploys to both platforms without a rewrite.
//
// It shims exactly the surface the handlers actually use:
//   req: method, url, headers (lowercased object), query, body,
//        socket.remoteAddress (gifts.ts rate-limit)
//   res: status(), statusCode, setHeader()/getHeader(), send(), json(),
//        end(), headersSent
//
// Anything new a handler starts using (streams, res.write, cookies…) must be
// added here — the typecheck (tsconfig.cloudflare.json) will not catch usage
// reached only through the loose `VercelRequest`/`VercelResponse` types.
// =============================================================================

// `any` on purpose: the real handlers are typed (req: VercelRequest, res:
// VercelResponse), and function-parameter contravariance would reject them
// against any narrower shim type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VercelStyleHandler = (req: any, res: any) => Promise<void> | void;

// On Vercel these come from the `/(.*)` header block in vercel.json, which also
// covers /api/*. On Cloudflare that block lives in public/_headers, which only
// applies to STATIC assets — API responses come from this adapter, so they must
// be set here or /api/* would answer without them. Only the document-level
// directives are needed: the one HTML response an API route can return is the
// admin refund receipt (no inline <script>, so script-src 'self' is fine).
// KEEP IN SYNC with vercel.json + public/_headers.
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

interface ShimResponse {
  statusCode: number;
  headersSent: boolean;
  status(code: number): ShimResponse;
  setHeader(name: string, value: string | number | readonly string[]): ShimResponse;
  getHeader(name: string): string | undefined;
  removeHeader(name: string): void;
  send(payload?: unknown): ShimResponse;
  json(payload: unknown): ShimResponse;
  end(payload?: string | Uint8Array): ShimResponse;
}

/** Vercel merges route params into req.query; `params` replicates that. */
export async function runVercelHandler(
  handler: VercelStyleHandler,
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
  const clientIp = headers['cf-connecting-ip'] ?? '';
  if (!headers['x-forwarded-for'] && clientIp) {
    headers['x-forwarded-for'] = clientIp;
  }

  // Body parsing, matching what @vercel/node gives the handlers: parsed JSON
  // for application/json, raw string otherwise (parseBody() in _lib/http.ts
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

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query,
    body,
    cookies: {},
    socket: { remoteAddress: clientIp }
  };

  let statusCode = 200;
  const resHeaders = new Headers();
  let responseBody: string | Uint8Array | null = null;
  let finished = false;

  const res: ShimResponse = {
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
  // sending (which on Vercel would hang the request until the platform 504s).
  if (!finished) {
    statusCode = 500;
    resHeaders.set('content-type', 'application/json; charset=utf-8');
    responseBody = JSON.stringify({ error: 'internal_error' });
  }

  // Parity with the platform-level headers vercel.json puts on /api/(.*):
  // never cache API responses unless the handler opted into caching itself
  // (e.g. /api/tickets/qr marks its PNG immutable).
  if (!resHeaders.has('cache-control')) {
    resHeaders.set('cache-control', 'no-store');
  }
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    resHeaders.set(name, value);
  }

  return new Response(responseBody, { status: statusCode, headers: resHeaders });
}
