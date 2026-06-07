import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAdmin } from '../../../_lib/auth.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from '../../../_lib/http.js';
import { issueOrder, IssueError } from '../../../_lib/issue.js';

interface MarkPaidBody {
  payment_ref?: string;
}

// POST /api/admin/orders/:id/mark-paid  -> marks paid and triggers issuance
// (tickets + email). Idempotent: re-marking never duplicates tickets or emails.
export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) return sendJson(res, 400, { error: 'missing_order_id' });

  const body = parseBody<MarkPaidBody>(req);
  const paymentRef = (body.payment_ref ?? '').trim() || null;

  try {
    const result = await issueOrder(id, paymentRef);
    return sendJson(res, 200, {
      orderId: result.order.id,
      status: result.order.status,
      ticketCount: result.ticketCount,
      emailed: result.emailed
    });
  } catch (err) {
    if (err instanceof IssueError) {
      if (err.code === 'order_not_found') return sendJson(res, 404, { error: 'order_not_found' });
      if (err.code === 'order_cancelled') return sendJson(res, 409, { error: 'order_cancelled' });
    }
    throw err;
  }
});
