// The request/response surface every api/ handler is written against: a
// Node-style (req, res) pair. cloudflare/adapter.ts builds them from a Worker
// fetch() Request and turns the result back into a Response. Anything a
// handler starts using that isn't declared here must be added to the adapter
// too — these types are the contract between the two.

export interface ApiRequest {
  method: string;
  url: string;
  // Lowercased header names; one value per header.
  headers: Record<string, string | undefined>;
  // Query string + route params (e.g. `id`, `ticketId`, admin `path`).
  query: Record<string, string | string[]>;
  // Parsed JSON for application/json, the raw string otherwise; see parseBody().
  body: unknown;
  socket: { remoteAddress: string };
}

export interface ApiResponse {
  statusCode: number;
  readonly headersSent: boolean;
  status(code: number): ApiResponse;
  setHeader(name: string, value: string | number | readonly string[]): ApiResponse;
  getHeader(name: string): string | undefined;
  removeHeader(name: string): void;
  send(payload?: unknown): ApiResponse;
  json(payload: unknown): ApiResponse;
  end(payload?: string | Uint8Array): ApiResponse;
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

export function sendJson(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body));
}

export function sendHtml(res: ApiResponse, status: number, html: string): void {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
}

export function methodNotAllowed(res: ApiResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: 'method_not_allowed' });
}

/**
 * The adapter parses JSON bodies already, but tolerate a raw string body too
 * (e.g. when content-type is missing). Returns {} for empty bodies.
 */
export function parseBody<T = Record<string, unknown>>(req: ApiRequest): T {
  const body = req.body;
  if (body == null || body === '') return {} as T;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as T;
    } catch {
      return {} as T;
    }
  }
  return body as T;
}

/** Wraps a handler so any thrown error becomes a 500 instead of a crash. */
export function withErrorHandling(handler: ApiHandler): ApiHandler {
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    try {
      await handler(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      // Don't leak internals to clients; log for server-side debugging.
      console.error('[api error]', message, err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
  };
}
