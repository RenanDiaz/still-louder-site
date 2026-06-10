import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, sendJson, withErrorHandling } from '../_lib/http.js';
import { isYappyConfigured, yappyCdnUrl } from '../_lib/yappy.js';

// GET /api/yappy/config — public, no secrets. Tells the frontend whether the
// Yappy button is live and which CDN to load the web component from (test vs
// prod is a server-side decision via YAPPY_BTN_ENV, so the bundle stays
// environment-agnostic and Yappy hides itself when not configured).
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const enabled = isYappyConfigured();
  return sendJson(res, 200, {
    enabled,
    cdnUrl: enabled ? yappyCdnUrl() : null
  });
});
