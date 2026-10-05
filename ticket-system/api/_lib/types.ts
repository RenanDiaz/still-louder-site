export type Tier = 'preventa' | 'general' | 'cortesia' | 'regalo';
export type PaymentMethod = 'yappy' | 'cuantoapp' | 'cash' | 'courtesy' | 'gift';
export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded';
export type TicketStatus = 'valid' | 'used' | 'void';

export interface Order {
  id: string;
  event_id: string;
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
  // GA4 ids of the buying browser (migration 0014) and the stamp that makes
  // the server-side `purchase` fire once — see api/_lib/ga.ts.
  ga_client_id: string | null;
  ga_session_id: string | null;
  ga_purchase_sent_at: string | null;
}

export interface Ticket {
  id: string;
  order_id: string;
  event_id: string;
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
  stage2_cap: number;
  sold_out: boolean;
  // Aforo total del evento (todas las tarifas) — migración 0010.
  total_capacity: number;
  total_committed: number;
  total_available: number;
  event_sold_out: boolean;
}

// 'event_closed' y 'wrong_event' no vienen del RPC: el endpoint los decide antes
// de tocar la BD — evento terminado (`isEventOver`) o QR de otro evento (el
// código firmado del token no coincide con el evento de la estación).
export type ValidateResult = 'valid' | 'already_used' | 'void' | 'not_found' | 'event_closed' | 'wrong_event';

export type GiftCampaignStatus = 'active' | 'exhausted' | 'closed';

export interface GiftCampaign {
  id: string;
  event_id: string;
  token: string;
  max_gifts: number;
  claimed_count: number;
  status: GiftCampaignStatus;
  created_at: string;
}

export interface GiftClaim {
  id: string;
  campaign_id: string;
  name: string;
  email: string;
  phone: string | null;
  order_id: string | null;
  claimer_ip: string | null;
  created_at: string;
}

// Outcome of the claim_gift RPC. 'claimed' carries the $0 order to issue;
// every other value maps to a friendly public message.
export type ClaimGiftStatus =
  | 'claimed'
  | 'exhausted'
  | 'closed'
  | 'already_claimed'
  | 'not_found';

export interface ClaimGiftRow {
  status: ClaimGiftStatus;
  order_id: string | null;
}
