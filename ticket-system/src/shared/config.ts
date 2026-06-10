// Client-side display config. NO secrets here — this is bundled into the
// browser. Prices shown here are for display only; the server is authoritative.

export const EVENT = {
  name: 'When We Were Young 3',
  shortName: 'WWWY3',
  band: 'Still Louder',
  venue: 'Hops',
  // ISO dates (local Panama time, UTC-5).
  presaleStart: '2026-06-15T00:00:00-05:00',
  eventDate: '2026-08-01T20:00:00-05:00'
} as const;

export const TIERS = {
  preventa: { label: 'Preventa', priceLabel: '$6', priceCents: 600 },
  general: { label: 'General (día del evento)', priceLabel: '$8', priceCents: 800 }
} as const;

export type TierKey = keyof typeof TIERS;

export const PAYMENT_METHODS = [
  // 'yappy' is only offered when GET /api/yappy/config says it's enabled
  // (i.e. the server has the Botón de Pago credentials configured).
  { value: 'yappy', label: 'Yappy' },
  { value: 'cuantoapp', label: 'Tarjeta (CuantoApp)' },
  { value: 'cash', label: 'Efectivo' }
] as const;
