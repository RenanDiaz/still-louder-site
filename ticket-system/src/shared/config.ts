// Client-side display config. NO secrets here — this is bundled into the
// browser. Prices shown here are for display only; the server is authoritative.

export const EVENT = {
  name: 'When We Were Young 3',
  shortName: 'WWWY3',
  band: 'Still Louder',
  venue: 'Hops',
  // ISO dates (local Panama time, UTC-5).
  presaleStart: '2026-06-15T00:00:00-05:00',
  // Presale closes at the start of the event day; from then on only the
  // general/"día del evento" price applies. Mirrored server-side in
  // api/_lib/pricing.ts (PRESALE_END_ISO) — the server is authoritative.
  presaleEnd: '2026-08-01T00:00:00-05:00',
  eventDate: '2026-08-01T20:00:00-05:00'
} as const;

export const TIERS = {
  preventa: { label: 'Preventa', priceLabel: '$6', priceCents: 600 },
  general: { label: 'General (día del evento)', priceLabel: '$8', priceCents: 800 }
} as const;

export type TierKey = keyof typeof TIERS;

// Display labels for EVERY tier that can appear on a ticket, including the
// admin-only 'cortesia' (which must never show up in the purchase flow's TIERS).
export const TIER_LABELS: Record<string, string> = {
  preventa: 'Preventa',
  general: 'General',
  cortesia: 'Cortesía'
};

export const PAYMENT_METHODS = [
  // 'yappy' is only offered when GET /api/yappy/config says it's enabled
  // (i.e. the server has the Botón de Pago credentials configured).
  { value: 'yappy', label: 'Yappy' },
  { value: 'cuantoapp', label: 'Tarjeta (CuantoApp)' },
  { value: 'cash', label: 'Efectivo' }
] as const;
