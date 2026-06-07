import type { PaymentMethod, Tier } from './types.js';

// Prices are authoritative on the server. The client never sends an amount;
// we derive total_cents here from (tier, quantity) so a tampered request can't
// change what's owed.
const TIER_PRICE_CENTS: Record<Tier, number> = {
  preventa: 600, // $6 presale
  general: 800 // $8 day-of / general
};

export function priceFor(tier: Tier, quantity: number): number {
  return TIER_PRICE_CENTS[tier] * quantity;
}

// How long a pending order holds its presale cupo before cleanup frees it.
// Manual methods (cash / CuantoApp) need a generous window because
// reconciliation is human; Yappy confirms instantly so it can be short.
const RESERVATION_MINUTES: Record<PaymentMethod, number> = {
  cash: 48 * 60,
  cuantoapp: 48 * 60,
  yappy: 15
};

export function reservationMinutesFor(method: PaymentMethod): number {
  return RESERVATION_MINUTES[method];
}

export const MAX_QUANTITY_PER_ORDER = 10;
