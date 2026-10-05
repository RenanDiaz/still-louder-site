import { getSupabase } from './_lib/supabase.js';
import {
  type ApiRequest,
  type ApiResponse,
  methodNotAllowed,
  parseBody,
  sendJson,
  withErrorHandling
} from './_lib/http.js';
import {
  areSalesOpen,
  getEventBySlug,
  getCurrentEvent,
  getTierPrices,
  haveSalesEnded,
  isPresaleOpen
} from './_lib/events.js';
import { MAX_QUANTITY_PER_ORDER, priceBreakdown, reservationMinutesFor } from './_lib/pricing.js';
import { sendOrderNotificationEmail } from './_lib/email.js';
import { cuantoappLinkFor } from './_lib/cuantoapp.js';
import { GA_CLIENT_ID_RE, GA_SESSION_ID_RE } from './_lib/ga.js';
import type { Order, PaymentMethod, PresaleStatus, Tier } from './_lib/types.js';

const TIERS: Tier[] = ['preventa', 'general'];
const METHODS: PaymentMethod[] = ['yappy', 'cuantoapp', 'cash'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateOrderBody {
  event?: string; // slug; omitted = the current event
  buyer_name?: string;
  buyer_email?: string;
  buyer_phone?: string;
  tier?: string;
  quantity?: number;
  payment_method?: string;
  // GA4 ids of this browser (attribution only; see api/_lib/ga.ts).
  ga_client_id?: string;
  ga_session_id?: string;
}

function paymentInstructions(method: PaymentMethod, totalCents: number, quantity: number) {
  const amount = `$${(totalCents / 100).toFixed(2)}`;
  switch (method) {
    case 'cuantoapp':
      return {
        method,
        amount,
        link: cuantoappLinkFor(quantity),
        note: `Paga el monto exacto (${amount}) con tarjeta a través del enlace de CuantoApp. Tu entrada se envía al confirmar el pago.`
      };
    case 'cash':
      return {
        method,
        amount,
        note: 'Coordina el pago en efectivo por nuestros canales oficiales (@still_louder). Reservamos tu cupo por 48 horas.'
      };
    case 'yappy':
      return {
        method,
        amount,
        note: 'Confirma el pago con el botón de Yappy. Tu reserva dura 15 minutos; la entrada llega a tu correo al confirmarse el pago.'
      };
  }
}

export default withErrorHandling(async (req: ApiRequest, res: ApiResponse) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const body = parseBody<CreateOrderBody>(req);
  const buyerName = (body.buyer_name ?? '').trim();
  const buyerEmail = (body.buyer_email ?? '').trim().toLowerCase();
  const buyerPhone = (body.buyer_phone ?? '').trim() || null;
  const tier = body.tier as Tier;
  const method = body.payment_method as PaymentMethod;
  const quantity = Number(body.quantity);

  // --- Validation ---
  if (buyerName.length < 2) {
    return sendJson(res, 400, { error: 'invalid_name' });
  }
  if (!EMAIL_RE.test(buyerEmail)) {
    return sendJson(res, 400, { error: 'invalid_email' });
  }
  if (!TIERS.includes(tier)) {
    return sendJson(res, 400, { error: 'invalid_tier' });
  }
  if (!METHODS.includes(method)) {
    return sendJson(res, 400, { error: 'invalid_payment_method' });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ORDER) {
    return sendJson(res, 400, { error: 'invalid_quantity' });
  }
  // The event decides everything below: which one is being sold, its dates
  // and its prices. The client only names it (slug); a draft is never public.
  const slug = (body.event ?? '').trim();
  const event = slug ? await getEventBySlug(slug) : await getCurrentEvent();
  if (!event || event.status === 'draft') {
    return sendJson(res, 404, { error: 'event_not_found' });
  }
  // El evento ya pasó (o está archivado): la venta está cerrada en TODAS las
  // tarifas, quede cupo o no. El cliente reemplaza el formulario por el aviso
  // de cierre al recibir este código — un POST directo tampoco pasa.
  if (haveSalesEnded(event)) {
    return sendJson(res, 409, { error: 'sales_closed' });
  }
  // Not on sale (teaser / paused) or before presale_start: nothing is sold yet.
  if (!areSalesOpen(event)) {
    return sendJson(res, 409, { error: event.status === 'on_sale' ? 'sales_not_open' : 'sales_closed' });
  }
  // Once the presale window has closed, preventa can no longer be sold — even
  // if cupo remains. The client falls back to general on this error.
  if (tier === 'preventa' && !isPresaleOpen(event)) {
    return sendJson(res, 409, { error: 'presale_ended' });
  }
  // The tier is not the buyer's choice: while presale is open and has cupo,
  // nobody should pay the (higher) general price. This guards against stale
  // or tampered clients; the current client only sends 'general' when presale
  // is unavailable. The extra RPC only runs during the presale window.
  if (tier === 'general' && isPresaleOpen(event)) {
    const { data: presaleStatus, error: presaleError } = await getSupabase()
      .rpc('presale_status', { p_event_id: event.id })
      .single<PresaleStatus>();
    if (presaleError) throw new Error(`presale_status failed: ${presaleError.message}`);
    // Si el evento ya está agotado no hay nada que redirigir a preventa: el
    // create_order de abajo lo rechazaría igual (EVENT_SOLD_OUT, race-safe).
    if (!presaleStatus!.sold_out && !presaleStatus!.event_sold_out) {
      return sendJson(res, 409, { error: 'presale_available' });
    }
  }

  // El precio se calcula en el servidor; el cliente no puede influir en él. El
  // total incluye el recargo por servicio que absorbe la comisión del método de
  // pago, de modo que el neto (precio base × cantidad) lo recibe la banda.
  const unitPrice = (await getTierPrices(event.id))[tier as 'preventa' | 'general'];
  // A sellable tier without a configured price would create a $0 order: refuse.
  if (!(unitPrice > 0)) {
    return sendJson(res, 409, { error: 'tier_unavailable' });
  }
  const { netCents, feeCents, totalCents } = priceBreakdown(unitPrice, quantity, method);
  const reservationMinutes = reservationMinutesFor(method);

  const { data: order, error } = await getSupabase()
    .rpc('create_order', {
      p_event_id: event.id,
      p_buyer_name: buyerName,
      p_buyer_email: buyerEmail,
      p_buyer_phone: buyerPhone,
      p_tier: tier,
      p_quantity: quantity,
      p_total_cents: totalCents,
      p_net_cents: netCents,
      p_fee_cents: feeCents,
      p_payment_method: method,
      p_reservation_minutes: reservationMinutes
    })
    .single<Order>();

  if (error) {
    // Aforo total agotado (migración 0010): no se vende más, en ninguna tarifa.
    if (error.message.includes('EVENT_SOLD_OUT')) {
      return sendJson(res, 409, { error: 'sold_out' });
    }
    if (error.message.includes('PRESALE_SOLD_OUT')) {
      return sendJson(res, 409, { error: 'presale_sold_out' });
    }
    throw new Error(`create_order failed: ${error.message}`);
  }

  // Atribución GA4 del `purchase` futuro. Best-effort: ids con formato
  // inválido se ignoran y un fallo aquí solo deja la orden sin atribución.
  const gaClientId =
    typeof body.ga_client_id === 'string' && GA_CLIENT_ID_RE.test(body.ga_client_id) ? body.ga_client_id : null;
  if (gaClientId) {
    const gaSessionId =
      typeof body.ga_session_id === 'string' && GA_SESSION_ID_RE.test(body.ga_session_id) ? body.ga_session_id : null;
    const { error: gaError } = await getSupabase()
      .from('orders')
      .update({ ga_client_id: gaClientId, ga_session_id: gaSessionId })
      .eq('id', order!.id);
    if (gaError) console.error('[orders] ga attribution update failed', gaError);
  }

  // Aviso interno al operador de que se registró una compra. Best-effort: un
  // fallo de correo no debe tumbar la creación de la orden ni afectar al comprador.
  try {
    await sendOrderNotificationEmail(order!, event);
  } catch (notifyError) {
    console.error('[orders] order notification email failed', notifyError);
  }

  return sendJson(res, 201, {
    orderId: order!.id,
    event: event.slug,
    tier: order!.tier,
    quantity: order!.quantity,
    totalCents: order!.total_cents,
    // Desglose para mostrar al comprador: neto + "Cargo por servicio" = total.
    breakdown: {
      netCents: order!.net_cents,
      feeCents: order!.fee_cents,
      totalCents: order!.total_cents
    },
    reservationExpiresAt: order!.reservation_expires_at,
    payment: paymentInstructions(method, totalCents, quantity)
  });
});
