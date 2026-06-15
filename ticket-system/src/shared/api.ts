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

export interface PriceBreakdown {
  netCents: number;
  feeCents: number;
  totalCents: number;
}

export interface CreateOrderResponse {
  orderId: string;
  tier: string;
  quantity: number;
  totalCents: number;
  breakdown: PriceBreakdown;
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
  status: 'pending' | 'paid' | 'cancelled' | 'refunded';
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
  net_cents: number;
  fee_cents: number;
  payment_method: string;
  payment_ref: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  reservation_expires_at: string | null;
  emailed_at: string | null;
  refunded_at?: string | null;
  refund_ref?: string | null;
}

export interface AdminStats {
  presale: {
    capacity: number;
    paid: number;
    pending: number;
    courtesy: number;
    available: number;
    stage2Active: boolean;
    soldOut: boolean;
  };
  generalPaid: number;
  courtesyTickets: number;
  totalTicketsPaid: number;
  // revenueCents = neto que recibe la banda; feesCents = recargos por servicio
  // (comisiones); grossCents = total cobrado al comprador.
  revenueCents: number;
  feesCents: number;
  grossCents: number;
  revenueByMethod: Record<string, number>;
  // Reembolsos (excluidos de las cifras de ingresos de arriba).
  refundedOrders: number;
  refundedTickets: number;
  refundedGrossCents: number;
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

export function ensureWalletClass(
  password: string
): Promise<{ classId: string; created: boolean }> {
  return request('/api/admin/wallet/google/ensure-class', {
    method: 'POST',
    headers: authHeader(password)
  });
}

export function cancelOrder(
  password: string,
  orderId: string
): Promise<{ orderId: string; status: string }> {
  return request(`/api/admin/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: authHeader(password)
  });
}

export interface RefundResult {
  orderId: string;
  status: string;
  via: 'yappy' | 'manual';
  voidedCount: number;
  refundRef: string | null;
}

// Refunds a paid order. By default a Yappy order is reversed via Yappy's API;
// pass { manual: true } to skip the API call and just record the refund (cash /
// CuantoApp, or a Yappy charge already settled that is refunded by hand).
export function refundOrder(
  password: string,
  orderId: string,
  opts: { manual?: boolean; refund_ref?: string } = {}
): Promise<RefundResult> {
  return request<RefundResult>(`/api/admin/orders/${orderId}/refund`, {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify(opts)
  });
}

// Fetches the printable refund receipt (HTML) for a refunded order. Unlike the
// JSON endpoints this returns raw HTML, so it bypasses the shared `request`
// helper (which parses JSON) and reads the body as text. Errors still come back
// as JSON, so we surface their `error` code the same way.
export async function fetchRefundReceipt(password: string, orderId: string): Promise<string> {
  const res = await fetch(`/api/admin/orders/${orderId}/refund-receipt`, {
    headers: authHeader(password)
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const data = (await res.json()) as ApiError;
      if (data.error) code = data.error;
    } catch {
      // non-JSON error body; keep the http_<status> code
    }
    const err = new Error(code) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return res.text();
}

export function resendTicketEmail(
  password: string,
  orderId: string
): Promise<{ orderId: string; ticketCount: number }> {
  return request(`/api/admin/orders/${orderId}/resend-email`, {
    method: 'POST',
    headers: authHeader(password)
  });
}

export interface CreateCourtesyInput {
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  note?: string;
  send_email?: boolean;
}

export function createCourtesyOrder(
  password: string,
  input: CreateCourtesyInput
): Promise<{ orderId: string; ticketCount: number; emailed: boolean }> {
  return request('/api/admin/courtesy', {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify(input)
  });
}

export interface AdminTicket {
  id: string;
  order_id: string;
  tier: string;
  status: 'valid' | 'used' | 'void';
  used_at: string | null;
  used_by: string | null;
  created_at: string;
  buyer_name: string;
  buyer_email: string;
}

export interface TicketCounts {
  total: number;
  valid: number;
  used: number;
  void: number;
}

export interface AdminTicketsResponse {
  tickets: AdminTicket[];
  stats: TicketCounts & { byTier: Record<string, TicketCounts> };
}

export function fetchAdminTickets(
  password: string,
  params: { q?: string; status?: string; tier?: string } = {}
): Promise<AdminTicketsResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.status) qs.set('status', params.status);
  if (params.tier) qs.set('tier', params.tier);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request<AdminTicketsResponse>(`/api/admin/tickets${suffix}`, {
    headers: authHeader(password)
  });
}

export function revokeTicket(
  password: string,
  ticketId: string
): Promise<{ ticketId: string; status: string }> {
  return request(`/api/admin/tickets/${ticketId}/revoke`, {
    method: 'POST',
    headers: authHeader(password)
  });
}

export function unrevokeTicket(
  password: string,
  ticketId: string
): Promise<{ ticketId: string; status: string }> {
  return request(`/api/admin/tickets/${ticketId}/unrevoke`, {
    method: 'POST',
    headers: authHeader(password)
  });
}

// --- Support (read-only customer support) ------------------------------------
// Reuses the admin endpoints, but the server gates these with isSupport() and
// withholds the sales stats / full table from the support role. resendTicketEmail
// (above) is also support-accessible. The password is SUPPORT_PASSWORD (or the
// admin password). See api/admin.ts.

// A ticket as returned by the support order-detail endpoint — no buyer fields,
// since the parent order already carries them.
export type SupportTicket = Pick<
  AdminTicket,
  'id' | 'order_id' | 'tier' | 'status' | 'used_at' | 'used_by' | 'created_at'
>;

export interface SupportOrderDetail {
  order: AdminOrder;
  tickets: SupportTicket[];
}

// Search orders by name, email, phone or full order id. An empty query returns
// no rows (the support role never receives the whole table).
export function fetchSupportOrders(
  password: string,
  q: string
): Promise<{ orders: AdminOrder[] }> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request<{ orders: AdminOrder[] }>(`/api/admin/orders${suffix}`, {
    headers: authHeader(password)
  });
}

export function fetchSupportOrder(
  password: string,
  orderId: string
): Promise<SupportOrderDetail> {
  return request<SupportOrderDetail>(`/api/admin/orders/${orderId}`, {
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
