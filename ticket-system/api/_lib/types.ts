export type Tier = 'preventa' | 'general' | 'cortesia';
export type PaymentMethod = 'yappy' | 'cuantoapp' | 'cash' | 'courtesy';
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded';
export type TicketStatus = 'valid' | 'used' | 'void';

export interface Order {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  tier: Tier;
  quantity: number;
  // total_cents = lo que paga el comprador (incluye el recargo por servicio).
  // net_cents   = lo que recibe la banda (precio base × cantidad).
  // fee_cents   = recargo por servicio = total_cents − net_cents.
  total_cents: number;
  net_cents: number;
  fee_cents: number;
  payment_method: PaymentMethod;
  payment_ref: string | null;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  reservation_expires_at: string | null;
  emailed_at: string | null;
  // Set when the order is refunded (status -> 'refunded'); refund_ref holds the
  // reversed Yappy transactionId or the admin's manual reference.
  refunded_at: string | null;
  refund_ref: string | null;
  // Short ref (<= 15 alphanumeric chars) sent to Yappy as its orderId — the
  // UUID is too long for Yappy's 15-char limit. Unique; resolved in the IPN.
  order_ref: string | null;
  // transactionId returned by Yappy's payment-wc (audit/reconciliation).
  yappy_transaction_id: string | null;
}

export interface Ticket {
  id: string;
  order_id: string;
  tier: Tier;
  status: TicketStatus;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}

export interface PresaleStatus {
  capacity: number;
  paid_count: number;
  pending_count: number;
  courtesy_count: number;
  committed: number;
  available: number;
  stage2_active: boolean;
  sold_out: boolean;
}

export type ValidateResult = 'valid' | 'already_used' | 'void' | 'not_found';
