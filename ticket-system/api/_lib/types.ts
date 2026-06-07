export type Tier = 'preventa' | 'general';
export type PaymentMethod = 'yappy' | 'cuantoapp' | 'cash';
export type OrderStatus = 'pending' | 'paid' | 'cancelled';
export type TicketStatus = 'valid' | 'used' | 'void';

export interface Order {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  tier: Tier;
  quantity: number;
  total_cents: number;
  payment_method: PaymentMethod;
  payment_ref: string | null;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  reservation_expires_at: string | null;
  emailed_at: string | null;
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
  committed: number;
  available: number;
  stage2_active: boolean;
  sold_out: boolean;
}

export type ValidateResult = 'valid' | 'already_used' | 'void' | 'not_found';
