// Thin fetch wrapper shared by all three surfaces. Passwords for the admin /
// staff gates are passed per-call and sent as a Bearer header; they live only
// in sessionStorage on the client and are checked server-side.

export interface ApiError {
  error: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error((data as ApiError).error ?? `http_${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    (err as Error & { code?: string }).code = (data as ApiError).error;
    throw err;
  }
  return data as T;
}

function authHeader(password: string): Record<string, string> {
  return { Authorization: `Bearer ${password}` };
}

// --- Public ------------------------------------------------------------------

export interface PresaleStatusResponse {
  available: number;
  capacity: number;
  stage2Active: boolean;
  soldOut: boolean;
}

export function getPresaleStatus(): Promise<PresaleStatusResponse> {
  return request<PresaleStatusResponse>('/api/presale/status');
}

export interface CreateOrderInput {
  buyer_name: string;
  buyer_email: string;
  buyer_phone?: string;
  tier: 'preventa' | 'general';
  quantity: number;
  payment_method: 'cuantoapp' | 'cash' | 'yappy';
}

export interface CreateOrderResponse {
  orderId: string;
  tier: string;
  quantity: number;
  totalCents: number;
  reservationExpiresAt: string | null;
  payment: { method: string; amount: string; link?: string; note: string };
}

export function createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
  return request<CreateOrderResponse>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

// --- Yappy (Botón de Pago) -----------------------------------------------------
// All Yappy credentials/tokens live server-side. The client only learns whether
// the button is enabled, which CDN serves the web component, and — per order —
// the {transactionId, token, documentName} trio that feeds eventPayment().

export interface YappyConfigResponse {
  enabled: boolean;
  cdnUrl: string | null;
}

export function getYappyConfig(): Promise<YappyConfigResponse> {
  return request<YappyConfigResponse>('/api/yappy/config');
}

export interface YappyPaymentSession {
  transactionId: string;
  token: string;
  documentName: string;
}

export function createYappyPayment(orderId: string): Promise<YappyPaymentSession> {
  return request<YappyPaymentSession>('/api/yappy/create-order', {
    method: 'POST',
    body: JSON.stringify({ orderId })
  });
}

export interface OrderStatusResponse {
  orderId: string;
  status: 'pending' | 'paid' | 'cancelled';
  paidAt: string | null;
  reservationExpiresAt: string | null;
  emailed: boolean;
}

export function getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  return request<OrderStatusResponse>(`/api/orders/${orderId}/status`);
}

// --- Admin -------------------------------------------------------------------

export interface AdminOrder {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  tier: string;
  quantity: number;
  total_cents: number;
  payment_method: string;
  payment_ref: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  reservation_expires_at: string | null;
  emailed_at: string | null;
}

export interface AdminStats {
  presale: {
    capacity: number;
    paid: number;
    pending: number;
    available: number;
    stage2Active: boolean;
    soldOut: boolean;
  };
  generalPaid: number;
  totalTicketsPaid: number;
  revenueCents: number;
}

export interface AdminOrdersResponse {
  orders: AdminOrder[];
  stats: AdminStats;
}

export function fetchAdminOrders(
  password: string,
  params: { q?: string; status?: string } = {}
): Promise<AdminOrdersResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request<AdminOrdersResponse>(`/api/admin/orders${suffix}`, {
    headers: authHeader(password)
  });
}

export function markOrderPaid(
  password: string,
  orderId: string,
  paymentRef?: string
): Promise<{ orderId: string; status: string; ticketCount: number; emailed: boolean }> {
  return request(`/api/admin/orders/${orderId}/mark-paid`, {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify({ payment_ref: paymentRef ?? null })
  });
}

export function toggleStage2(
  password: string,
  active: boolean
): Promise<{ stage2Active: boolean }> {
  return request('/api/admin/presale/stage2', {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify({ active })
  });
}

export function cleanupExpired(password: string): Promise<{ cancelled: number }> {
  return request('/api/admin/orders/cleanup', {
    method: 'POST',
    headers: authHeader(password)
  });
}

// --- Staff (gate) ------------------------------------------------------------

export type ValidateOutcome = 'valid' | 'already_used' | 'void' | 'not_found' | 'forged';

export interface ValidateResponse {
  result: ValidateOutcome;
  tier: string | null;
  usedAt: string | null;
  usedBy: string | null;
  buyerName: string | null;
}

export function validateTicket(
  password: string,
  token: string,
  station: string
): Promise<ValidateResponse> {
  return request<ValidateResponse>('/api/tickets/validate', {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify({ token, station })
  });
}
