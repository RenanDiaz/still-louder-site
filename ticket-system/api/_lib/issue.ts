import { getSupabase } from './supabase.js';
import { makeToken } from './hmac.js';
import { sendTicketEmail } from './email.js';
import type { Order, Ticket } from './types.js';

export class IssueError extends Error {
  constructor(
    public code: 'order_not_found' | 'order_cancelled' | 'db_error',
    message: string
  ) {
    super(message);
  }
}

export interface IssueResult {
  order: Order;
  ticketCount: number;
  emailed: boolean;
}

/**
 * The single, payment-method-agnostic issuance routine. Whatever marks an order
 * paid (admin button, cash, CuantoApp, future Yappy webhook) funnels here.
 *
 * Idempotent on every axis:
 *  - mark_order_paid (RPC) only transitions pending->paid once and only creates
 *    tickets when none exist.
 *  - the email is only sent when orders.emailed_at is null, then stamped, so a
 *    retry after a transient email failure resends at most once and a re-mark
 *    never double-sends.
 */
export async function issueOrder(orderId: string, paymentRef?: string | null): Promise<IssueResult> {
  const supabase = getSupabase();

  const { data: order, error } = await supabase
    .rpc('mark_order_paid', { p_order_id: orderId, p_payment_ref: paymentRef ?? null })
    .single<Order>();

  if (error) {
    if (error.message.includes('ORDER_NOT_FOUND')) {
      throw new IssueError('order_not_found', 'Order not found');
    }
    if (error.message.includes('ORDER_CANCELLED')) {
      throw new IssueError('order_cancelled', 'Order is cancelled and cannot be paid');
    }
    throw new IssueError('db_error', error.message);
  }
  if (!order) {
    throw new IssueError('order_not_found', 'Order not found');
  }

  const { data: tickets, error: ticketsError } = await supabase
    .from('tickets')
    .select('id')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (ticketsError) throw new IssueError('db_error', ticketsError.message);

  const ticketRows = (tickets ?? []) as Pick<Ticket, 'id'>[];
  const tokens = ticketRows.map((t) => makeToken(t.id));

  let emailed = false;
  if (!order.emailed_at && tokens.length > 0) {
    await sendTicketEmail(order, tokens);
    await supabase.rpc('mark_order_emailed', { p_order_id: orderId });
    emailed = true;
  }

  return { order, ticketCount: tokens.length, emailed };
}
