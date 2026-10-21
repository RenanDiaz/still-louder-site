import {
  type ApiRequest,
  type ApiResponse,
  methodNotAllowed,
  parseBody,
  sendJson,
  withErrorHandling
} from './_lib/http.js';
import { getContactStatus, maskEmail, unsubscribe, verifyUnsubscribeToken } from './_lib/marketing.js';

// Baja de las campañas de promoción (docs/features/campanas-promocion.md, D6).
// Público, sin auth: la autorización ES el token firmado (api/_lib/marketing.ts).
//
//   GET  /api/marketing/unsubscribe?t=…   -> { email_masked, status } (NO da de baja:
//        los escáneres de enlaces de los clientes de correo abren los links)
//   POST /api/marketing/unsubscribe       -> da de baja (idempotente), 200 { status }
//        - desde /baja: JSON { t }
//        - one-click RFC 8058 (Gmail/Apple Mail): form-urlencoded
//          "List-Unsubscribe=One-Click" con t en la query
// Token inválido -> 400 neutro, sin decir por qué.
//
// Solo toca marketing_contact: los correos transaccionales (QR, comprobantes)
// no consultan esa tabla, así que una baja nunca los afecta.

function firstQuery(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default withErrorHandling(async (req: ApiRequest, res: ApiResponse) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method === 'GET') {
    const email = verifyUnsubscribeToken(firstQuery(req.query.t));
    if (!email) return sendJson(res, 400, { error: 'invalid_token' });
    const status = await getContactStatus(email);
    // Sin fila o suscrito: se ofrece el botón. Cualquier otro estado ya no
    // recibe promociones.
    return sendJson(res, 200, {
      email_masked: maskEmail(email),
      status: status === null || status === 'subscribed' ? 'subscribed' : 'unsubscribed'
    });
  }

  if (req.method === 'POST') {
    // El cuerpo del one-click es un string form-urlencoded: parseBody() lo
    // devuelve como {} y el token sale de la query.
    const body = parseBody<{ t?: unknown }>(req);
    const token = typeof body.t === 'string' && body.t ? body.t : firstQuery(req.query.t);
    const email = verifyUnsubscribeToken(token);
    if (!email) return sendJson(res, 400, { error: 'invalid_token' });
    await unsubscribe(email);
    return sendJson(res, 200, { status: 'unsubscribed' });
  }

  return methodNotAllowed(res, ['GET', 'POST']);
});
