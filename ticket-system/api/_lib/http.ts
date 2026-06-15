import type { VercelRequest, VercelResponse } from '@vercel/node';

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body));
}

export function sendHtml(res: VercelResponse, status: number, html: string): void {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
}

export function methodNotAllowed(res: VercelResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  sendJson(res, 405, { error: 'method_not_allowed' });
}

/**
 * Vercel parses JSON bodies automatically, but tolerate a raw string body too
 * (e.g. when content-type is missing). Returns {} for empty bodies.
 */
export function parseBody<T = Record<string, unknown>>(req: VercelRequest): T {
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
export function withErrorHandling(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void> | void
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
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
