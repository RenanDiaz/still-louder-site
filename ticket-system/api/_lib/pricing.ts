import type { PaymentMethod, Tier } from './types.js';

// Prices are authoritative on the server. The client never sends an amount;
// we derive total_cents here from (tier, quantity) so a tampered request can't
// change what's owed.
const TIER_PRICE_CENTS: Record<Tier, number> = {
  preventa: 600, // $6 presale
  general: 800, // $8 day-of / general
  cortesia: 0, // admin-issued comps; never purchasable via /api/orders
  regalo: 0 // gift-campaign tickets; issued $0 via the hidden /regalo claim
};

export function priceFor(tier: Tier, quantity: number): number {
  return TIER_PRICE_CENTS[tier] * quantity;
}

// =============================================================================
// Recargo por método de pago ("Cargo por servicio")
// =============================================================================
// El comprador paga un precio "grossed-up" que absorbe la comisión del método,
// de modo que el NETO que recibe la banda iguala al precio base. La comisión es
// POR TRANSACCIÓN: el fijo (ej. CuantoApp $0.35) se aplica UNA sola vez sobre la
// orden completa, no por entrada — por eso el cálculo opera sobre el neto total
// y nunca multiplica el fijo por la cantidad.
//
//   precioFinal = (neto + feeFijo) / (1 − feePorcentual)   [redondeado HACIA
//                 ARRIBA al centavo, para que el neto nunca quede por debajo]
//
// Fuente de los números (junio 2026):
//   CuantoApp (tarjeta): 4.9% + $0.35 fijo
//   Yappy:               1.07% (1% + 7% ITBMS sobre ese 1%), sin fijo,
//                        comisión mínima $0.02
//   Efectivo / cortesía: sin recargo (precioFinal = neto)
interface FeeConfig {
  /** Comisión porcentual como fracción (0.049 = 4.9%). */
  pct: number;
  /** Comisión fija por transacción, en centavos. */
  fixedCents: number;
  /** Comisión mínima que cobra el procesador, en centavos. */
  minFeeCents: number;
}

const PAYMENT_FEES: Record<PaymentMethod, FeeConfig> = {
  cuantoapp: { pct: 0.049, fixedCents: 35, minFeeCents: 0 },
  yappy: { pct: 0.0107, fixedCents: 0, minFeeCents: 2 },
  cash: { pct: 0, fixedCents: 0, minFeeCents: 0 },
  courtesy: { pct: 0, fixedCents: 0, minFeeCents: 0 },
  gift: { pct: 0, fixedCents: 0, minFeeCents: 0 }
};

export interface PriceBreakdown {
  /** Lo que recibe la banda: precio base × cantidad. */
  netCents: number;
  /** Recargo por servicio = totalCents − netCents (lo que cubre la comisión). */
  feeCents: number;
  /** Lo que paga el comprador (neto + recargo). */
  totalCents: number;
}

/**
 * Desglose autoritativo del precio para una (tier, cantidad, método). El neto es
 * siempre el precio base; el total absorbe la comisión del método de pago.
 */
export function priceBreakdown(tier: Tier, quantity: number, method: PaymentMethod): PriceBreakdown {
  const netCents = priceFor(tier, quantity);
  if (netCents <= 0) return { netCents: 0, feeCents: 0, totalCents: 0 };

  const fee = PAYMENT_FEES[method];
  // Gross-up por transacción: el fijo se suma una sola vez. Redondeo hacia
  // arriba al centavo para garantizar neto ≥ base.
  let totalCents = Math.ceil((netCents + fee.fixedCents) / (1 - fee.pct));

  // Comisión mínima: si el procesador cobra un piso (Yappy $0.02) y el recargo
  // calculado no lo cubre, el comprador debe cubrir al menos ese piso para que
  // el neto no caiga por debajo del precio base.
  if (totalCents - netCents < fee.minFeeCents) {
    totalCents = netCents + fee.minFeeCents;
  }

  return { netCents, feeCents: totalCents - netCents, totalCents };
}

// Presale closes at the start of the event day (Panama time, UTC-5); after that
// only general/day-of pricing is sold, regardless of remaining cupo. Mirrors
// EVENT.presaleEnd in the client config — duplicated on purpose because the
// server is authoritative on what can be sold (the same pattern as prices).
const PRESALE_END_ISO = '2026-08-01T00:00:00-05:00';

export function isPresaleOpenByDate(now: Date = new Date()): boolean {
  return now.getTime() < new Date(PRESALE_END_ISO).getTime();
}

// Sales don't open until the presale start time (Panama time, UTC-5). The buy
// form is hidden client-side until then, but the server is authoritative: no
// order can be created before this instant, even via a direct POST. Mirrors
// EVENT.presaleStart in the client config.
const PRESALE_START_ISO = '2026-06-15T00:00:00-05:00';

export function areSalesOpenByDate(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(PRESALE_START_ISO).getTime();
}

// How long a pending order holds its presale cupo before cleanup frees it.
// Manual methods (cash / CuantoApp) need a generous window because
// reconciliation is human; Yappy confirms instantly so it can be short.
const RESERVATION_MINUTES: Record<PaymentMethod, number> = {
  cash: 48 * 60,
  cuantoapp: 48 * 60,
  yappy: 15,
  courtesy: 0, // courtesy orders are issued paid on the spot; never reserved
  gift: 0 // gift orders are issued paid immediately on claim; never reserved
};

export function reservationMinutesFor(method: PaymentMethod): number {
  return RESERVATION_MINUTES[method];
}

export const MAX_QUANTITY_PER_ORDER = 10;
