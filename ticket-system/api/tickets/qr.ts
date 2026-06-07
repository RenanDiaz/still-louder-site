import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, sendJson, withErrorHandling } from '../_lib/http.js';
import { verifyToken } from '../_lib/hmac.js';
import { tokenToPngBuffer } from '../_lib/qr.js';

// Stateless QR image for a signed token. Used as the inline <img src> in the
// confirmation email so the code renders in every mail client. Verifies the
// HMAC before rendering (so it can't be abused as an arbitrary QR generator)
// but never touches the database.
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const raw = req.query.t;
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token || !verifyToken(token)) {
    return sendJson(res, 400, { error: 'invalid_token' });
  }

  const png = await tokenToPngBuffer(token);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).send(png);
});
