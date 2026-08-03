import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from './_lib/supabase.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from './_lib/http.js';
import { haveSalesEnded } from './_lib/event.js';
import {
  MAX_QUANTITY_PER_ORDER,
  areSalesOpenByDate,
  isPresaleOpenByDate,
  priceBreakdown,
  reservationMinutesFor
} from './_lib/pricing.js';
import { sendOrderNotificationEmail } from './_lib/email.js';
import type { Order, PaymentMethod, PresaleStatus, Tier } from './_lib/types.js';

const TIERS: Tier[] = ['preventa', 'general'];
const METHODS: PaymentMethod[] = ['yappy', 'cuantoapp', 'cash'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateOrderBody {
  buyer_name?: string;
  buyer_email?: string;
  buyer_phone?: string;
  tier?: string;
  quantity?: number;
  payment_method?: string;
}

// CuantoApp es manual: cada cantidad (1–10) tiene su propio producto OCULTO en
// el catálogo, con el precio ya "grossed-up" (porque el fijo de $0.35 es por
// transacción, no por entrada). El operador crea esos productos una vez y pega
// sus links en CUANTOAPP_PAYMENT_URL_<n>; aquí elegimos el que corresponde a la
// cantidad. CUANTOAPP_PAYMENT_URL (sin sufijo) queda como fallback. El producto
// puede llevar dos precios (preventa/general): el comprador paga el monto exacto
// que le mostramos, y el admin marca el precio de preventa como agotado al
// cerrarse esa etapa.
function cuantoappLinkFor(quantity: number): string {
  return process.env[`CUANTOAPP_PAYMENT_URL_${quantity}`] ?? process.env.CUANTOAPP_PAYMENT_URL ?? '';
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

export default withErrorHandling(async (req: VercelRequest, res: VercelResponse) => {
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
  // Sales haven't opened yet: the buy form is hidden client-side until the
  // presale start time, but reject direct POSTs too — nothing is sold before then.
  if (!areSalesOpenByDate()) {
    return sendJson(res, 409, { error: 'sales_not_open' });
  }
  // El evento ya pasó: la venta está cerrada en TODAS las tarifas, quede cupo o
  // no. El cliente reemplaza el formulario por el aviso de cierre al recibir
  // este código, pero la decisión es de aquí — un POST directo tampoco pasa.
  if (haveSalesEnded()) {
    return sendJson(res, 409, { error: 'sales_closed' });
  }
  // Once the presale window has closed, preventa can no longer be sold — even
  // if cupo remains. The client falls back to general on this error.
  if (tier === 'preventa' && !isPresaleOpenByDate()) {
    return sendJson(res, 409, { error: 'presale_ended' });
  }
  // The tier is not the buyer's choice: while presale is open and has cupo,
  // nobody should pay the (higher) general price. This guards against stale
  // or tampered clients; the current client only sends 'general' when presale
  // is unavailable. The extra RPC only runs during the presale window.
  if (tier === 'general' && isPresaleOpenByDate()) {
    const { data: presaleStatus, error: presaleError } = await getSupabase()
      .rpc('presale_status')
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
  const { netCents, feeCents, totalCents } = priceBreakdown(tier, quantity, method);
  const reservationMinutes = reservationMinutesFor(method);

  const { data: order, error } = await getSupabase()
    .rpc('create_order', {
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

  // Aviso interno al operador de que se registró una compra. Best-effort: un
  // fallo de correo no debe tumbar la creación de la orden ni afectar al comprador.
  try {
    await sendOrderNotificationEmail(order!);
  } catch (notifyError) {
    console.error('[orders] order notification email failed', notifyError);
  }

  return sendJson(res, 201, {
    orderId: order!.id,
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
