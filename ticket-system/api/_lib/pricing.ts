import type { PaymentMethod, Tier } from './types.js';

// Prices are authoritative on the server. The client never sends an amount;
// we derive total_cents here from (tier, quantity) so a tampered request can't
// change what's owed.
const TIER_PRICE_CENTS: Record<Tier, number> = {
  preventa: 600, // $6 presale
  general: 800, // $8 day-of / general
  cortesia: 0 // admin-issued comps; never purchasable via /api/orders
};

export function priceFor(tier: Tier, quantity: number): number {
  return TIER_PRICE_CENTS[tier] * quantity;
}

// Presale closes at the start of the event day (Panama time, UTC-5); after that
// only general/day-of pricing is sold, regardless of remaining cupo. Mirrors
// EVENT.presaleEnd in the client config — duplicated on purpose because the
// server is authoritative on what can be sold (the same pattern as prices).
const PRESALE_END_ISO = '2026-08-01T00:00:00-05:00';

export function isPresaleOpenByDate(now: Date = new Date()): boolean {
  return now.getTime() < new Date(PRESALE_END_ISO).getTime();
}

// How long a pending order holds its presale cupo before cleanup frees it.
// Manual methods (cash / CuantoApp) need a generous window because
// reconciliation is human; Yappy confirms instantly so it can be short.
const RESERVATION_MINUTES: Record<PaymentMethod, number> = {
  cash: 48 * 60,
  cuantoapp: 48 * 60,
  yappy: 15,
  courtesy: 0 // courtesy orders are issued paid on the spot; never reserved
};

export function reservationMinutesFor(method: PaymentMethod): number {
  return RESERVATION_MINUTES[method];
}

export const MAX_QUANTITY_PER_ORDER = 10;
