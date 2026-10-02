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

// Appends ?event=<id> (plus any extra params) for the event-scoped admin routes.
function withEvent(path: string, eventId: string, params: Record<string, string | undefined> = {}): string {
  const qs = new URLSearchParams({ event: eventId });
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  return `${path}?${qs}`;
}

// --- Public ------------------------------------------------------------------

export type EventStatus = 'draft' | 'teaser' | 'on_sale' | 'archived';

// Public view of an event (from the `events` row). The client draws from it;
// the server stays authoritative on what can be sold.
export interface PublicEvent {
  slug: string;
  code: string;
  name: string;
  shortName: string;
  tagline: string | null;
  venue: string | null;
  venueAddress: string | null;
  startsAt: string;
  presaleStart: string;
  presaleEnd: string;
  salesEnd: string;
  eventEnd: string;
  status: EventStatus;
  theme: string;
  ogImageUrl: string | null;
  tiers: { preventa: number; general: number };
}

export interface PresaleNumbers {
  available: number;
  capacity: number;
  stage2Active: boolean;
  soldOut: boolean;
  // Aforo total del evento (todas las tarifas): boletos restantes y si ya no se
  // vende más. Alimentan el contador "quedan N" y el bloqueo del formulario.
  totalAvailable: number;
  eventSoldOut: boolean;
}

export interface PresaleStatusResponse {
  event: PublicEvent;
  // null while the event is a teaser (nothing on sale, no numbers revealed).
  presale: PresaleNumbers | null;
}

/** Event (by slug, or the current one when omitted) + its presale numbers. */
export function getPresaleStatus(slug?: string | null): Promise<PresaleStatusResponse> {
  const suffix = slug ? `?event=${encodeURIComponent(slug)}` : '';
  return request<PresaleStatusResponse>(`/api/presale/status${suffix}`);
}

export interface CreateOrderInput {
  event: string; // slug
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
  event: string;
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
  event: { slug: string | null };
  status: 'pending' | 'paid' | 'cancelled' | 'refunded';
  paidAt: string | null;
  reservationExpiresAt: string | null;
  emailed: boolean;
}

export function getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  return request<OrderStatusResponse>(`/api/orders/${orderId}/status`);
}

// --- Gift campaigns (hidden /regalo/<token> page) ----------------------------
// The token is the campaign secret carried in the URL path; PII only ever
// travels in the POST body. An unknown token yields a 404 (code 'not_found').

export interface GiftCampaignStatusResponse {
  status: 'active' | 'exhausted' | 'closed';
  event: {
    slug: string;
    name: string;
    shortName: string;
    venue: string | null;
    startsAt: string;
    theme: string;
  };
}

export function fetchGiftCampaign(token: string): Promise<GiftCampaignStatusResponse> {
  return request<GiftCampaignStatusResponse>(`/api/gifts?token=${encodeURIComponent(token)}`);
}

export interface ClaimGiftInput {
  token: string;
  name: string;
  email: string;
  phone?: string;
}

export interface ClaimGiftResponse {
  status: 'claimed';
  emailed: boolean;
}

// On success resolves with { status:'claimed' }. When the campaign ran out or
// the email already claimed, the server returns 409 with a `status`/`error`
// code that `request` surfaces as the thrown error's `.code`.
export function claimGift(input: ClaimGiftInput): Promise<ClaimGiftResponse> {
  return request<ClaimGiftResponse>('/api/gifts', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

// --- Admin -------------------------------------------------------------------

export interface AdminOrder {
  id: string;
  event_id: string;
  // Joined event summary (present on list/detail responses).
  events?: { slug: string; code: string; name: string; short_name: string } | null;
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
    stage2Cap: number;
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
  eventId: string,
  params: { q?: string; status?: string } = {}
): Promise<AdminOrdersResponse> {
  return request<AdminOrdersResponse>(withEvent('/api/admin/orders', eventId, params), {
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
  eventId: string,
  active: boolean,
  cap?: number
): Promise<{ stage2Active: boolean; stage2Cap: number }> {
  return request(withEvent('/api/admin/presale/stage2', eventId), {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify(cap === undefined ? { active } : { active, cap })
  });
}

export function cleanupExpired(password: string): Promise<{ cancelled: number }> {
  return request('/api/admin/orders/cleanup', {
    method: 'POST',
    headers: authHeader(password)
  });
}

export function ensureWalletClass(
  password: string,
  eventId: string
): Promise<{ classId: string; created: boolean }> {
  return request(withEvent('/api/admin/wallet/google/ensure-class', eventId), {
    method: 'POST',
    headers: authHeader(password)
  });
}

export type CuantoappLinkSource = 'specific' | 'fallback' | 'missing';

export interface CuantoappLinkRow {
  quantity: number;
  envVar: string;
  url: string;
  source: CuantoappLinkSource;
  /** Monto exacto (con recargo) que debe cobrar ese producto, por tipo. */
  amounts: { preventa: number; general: number };
}

export interface CuantoappLinksResponse {
  prices: { preventa: number; general: number };
  links: CuantoappLinkRow[];
}

export function fetchCuantoappLinks(password: string, eventId: string): Promise<CuantoappLinksResponse> {
  return request(withEvent('/api/admin/cuantoapp', eventId), { headers: authHeader(password) });
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
  eventId: string,
  input: CreateCourtesyInput
): Promise<{ orderId: string; ticketCount: number; emailed: boolean }> {
  return request(withEvent('/api/admin/courtesy', eventId), {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify(input)
  });
}

// --- Admin: gift campaigns ---------------------------------------------------

export interface GiftCampaign {
  id: string;
  token: string;
  max_gifts: number;
  claimed_count: number;
  status: 'active' | 'exhausted' | 'closed';
  created_at: string;
  url?: string;
}

export interface GiftClaimRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  order_id: string | null;
  created_at: string;
}

export interface GiftCampaignCreated {
  campaign: GiftCampaign;
  url: string;
  qrDataUrl: string;
}

export function createGiftCampaign(
  password: string,
  eventId: string,
  maxGifts: number
): Promise<GiftCampaignCreated> {
  return request<GiftCampaignCreated>(withEvent('/api/admin/gifts', eventId), {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify({ max_gifts: maxGifts })
  });
}

export function listGiftCampaigns(password: string, eventId: string): Promise<{ campaigns: GiftCampaign[] }> {
  return request<{ campaigns: GiftCampaign[] }>(withEvent('/api/admin/gifts', eventId), {
    headers: authHeader(password)
  });
}

export interface GiftCampaignDetail {
  campaign: GiftCampaign;
  url: string;
  qrDataUrl: string;
  claims: GiftClaimRow[];
}

export function getGiftCampaign(password: string, id: string): Promise<GiftCampaignDetail> {
  return request<GiftCampaignDetail>(`/api/admin/gifts/${id}`, {
    headers: authHeader(password)
  });
}

export function closeGiftCampaign(
  password: string,
  id: string
): Promise<{ campaign: GiftCampaign }> {
  return request<{ campaign: GiftCampaign }>(`/api/admin/gifts/${id}/close`, {
    method: 'POST',
    headers: authHeader(password)
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
  eventId: string,
  params: { q?: string; status?: string; tier?: string } = {}
): Promise<AdminTicketsResponse> {
  return request<AdminTicketsResponse>(withEvent('/api/admin/tickets', eventId, params), {
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

// --- Admin: events ------------------------------------------------------------

export interface AdminEvent {
  id: string;
  slug: string;
  code: string;
  name: string;
  short_name: string;
  tagline: string | null;
  venue: string | null;
  venue_address: string | null;
  starts_at: string;
  presale_start: string;
  presale_end: string;
  sales_end: string;
  event_end: string;
  presale_stage1_cap: number;
  presale_stage2_cap: number;
  presale_stage2_active: boolean;
  total_capacity: number;
  status: EventStatus;
  theme: string;
  og_image_url: string | null;
  tiers: { preventa: number; general: number };
  paidTickets?: number;
}

export interface EventInput {
  slug?: string;
  code?: string;
  name?: string;
  short_name?: string;
  tagline?: string;
  venue?: string;
  venue_address?: string;
  starts_at?: string;
  presale_start?: string;
  presale_end?: string;
  sales_end?: string;
  event_end?: string;
  presale_stage1_cap?: number;
  presale_stage2_cap?: number;
  total_capacity?: number;
  theme?: string;
  og_image_url?: string;
  tiers?: { preventa?: number; general?: number };
}

export function listEvents(password: string): Promise<{ events: AdminEvent[] }> {
  return request<{ events: AdminEvent[] }>('/api/admin/events', { headers: authHeader(password) });
}

export function createEvent(password: string, input: EventInput): Promise<{ event: AdminEvent }> {
  return request<{ event: AdminEvent }>('/api/admin/events', {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify(input)
  });
}

export function updateEvent(password: string, id: string, input: EventInput): Promise<{ event: AdminEvent }> {
  return request<{ event: AdminEvent }>(`/api/admin/events/${id}`, {
    method: 'PATCH',
    headers: authHeader(password),
    body: JSON.stringify(input)
  });
}

export function setEventStatus(password: string, id: string, status: EventStatus): Promise<{ event: AdminEvent }> {
  return request<{ event: AdminEvent }>(`/api/admin/events/${id}/status`, {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify({ status })
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

// 'forged' lo decide el endpoint por firma inválida; 'wrong_event' cuando el QR
// es de otro evento; 'event_closed' cuando el evento ya terminó y la puerta
// está congelada. Los tres se deciden sin tocar las entradas.
export type ValidateOutcome =
  | 'valid'
  | 'already_used'
  | 'void'
  | 'not_found'
  | 'forged'
  | 'event_closed'
  | 'wrong_event';

export interface ValidateResponse {
  result: ValidateOutcome;
  tier: string | null;
  usedAt: string | null;
  usedBy: string | null;
  buyerName: string | null;
  // Only for 'wrong_event': the name of the event the QR belongs to.
  qrEventName?: string;
}

export function validateTicket(
  password: string,
  token: string,
  station: string,
  event: string
): Promise<ValidateResponse> {
  return request<ValidateResponse>('/api/tickets/validate', {
    method: 'POST',
    headers: authHeader(password),
    body: JSON.stringify({ token, station, event })
  });
}

export interface GateEvent {
  slug: string;
  name: string;
  shortName: string;
  startsAt: string;
}

/** Events a gate station can scan for (teaser/on_sale, not yet over). */
export function listGateEvents(password: string): Promise<{ events: GateEvent[] }> {
  return request<{ events: GateEvent[] }>('/api/tickets/validate', { headers: authHeader(password) });
}
