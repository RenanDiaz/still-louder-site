import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from './_lib/supabase.js';
import { methodNotAllowed, parseBody, sendJson, withErrorHandling } from './_lib/http.js';
import {
  MAX_QUANTITY_PER_ORDER,
  isPresaleOpenByDate,
  priceFor,
  reservationMinutesFor
} from './_lib/pricing.js';
import { sendOrderNotificationEmail } from './_lib/email.js';
import type { Order, PaymentMethod, Tier } from './_lib/types.js';

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

function paymentInstructions(method: PaymentMethod, totalCents: number) {
  const amount = `$${(totalCents / 100).toFixed(2)}`;
  switch (method) {
    case 'cuantoapp':
      return {
        method,
        amount,
        // Operator pastes the CuantoApp checkout link here via env.
        link: process.env.CUANTOAPP_PAYMENT_URL ?? '',
        note: 'Paga con tarjeta a través del enlace de CuantoApp. Tu entrada se envía al confirmar el pago.'
      };
    case 'cash':
      return {
        method,
        amount,
        note: 'Coordina el pago en efectivo por nuestros canales oficiales (@stilllouder). Reservamos tu cupo por 48 horas.'
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
  // Once the presale window has closed, preventa can no longer be sold — even
  // if cupo remains. The client falls back to general on this error.
  if (tier === 'preventa' && !isPresaleOpenByDate()) {
    return sendJson(res, 409, { error: 'presale_ended' });
  }

  // Total is computed server-side; the client cannot influence the price.
  const totalCents = priceFor(tier, quantity);
  const reservationMinutes = reservationMinutesFor(method);

  const { data: order, error } = await getSupabase()
    .rpc('create_order', {
      p_buyer_name: buyerName,
      p_buyer_email: buyerEmail,
      p_buyer_phone: buyerPhone,
      p_tier: tier,
      p_quantity: quantity,
      p_total_cents: totalCents,
      p_payment_method: method,
      p_reservation_minutes: reservationMinutes
    })
    .single<Order>();

  if (error) {
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
    reservationExpiresAt: order!.reservation_expires_at,
    payment: paymentInstructions(method, totalCents)
  });
});
