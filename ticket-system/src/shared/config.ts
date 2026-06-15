// Client-side display config. NO secrets here — this is bundled into the
// browser. Prices shown here are for display only; the server is authoritative.

export const EVENT = {
  name: 'When We Were Young 3',
  shortName: 'WWWY3',
  band: 'Still Louder',
  venue: 'Hops',
  // ISO dates (local Panama time, UTC-5).
  // La preventa abre a la medianoche del 15 de junio: el countdown apunta aquí y
  // el formulario de compra permanece oculto hasta esta hora (cliente y servidor).
  presaleStart: '2026-06-15T00:00:00-05:00',
  // Presale closes at the start of the event day; from then on only the
  // general/"día del evento" price applies. Mirrored server-side in
  // api/_lib/pricing.ts (PRESALE_END_ISO) — the server is authoritative.
  presaleEnd: '2026-08-01T00:00:00-05:00',
  eventDate: '2026-08-01T20:00:00-05:00'
} as const;

// Canales oficiales de la banda. El Instagram es el canal principal; el enlace
// usa ig.me/m/ para abrir un mensaje directo (DM) en vez del perfil.
export const SOCIAL = {
  instagramHandle: '@still_louder',
  instagramDm: 'https://ig.me/m/still_louder'
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

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]['value'];

// Recargo por método de pago — espejo de api/_lib/pricing.ts (PAYMENT_FEES).
// SOLO para mostrar el total estimado al comprador; el servidor recalcula y es
// la fuente de verdad. Mantener en sync con el backend al cambiar comisiones.
const PAYMENT_FEES: Record<PaymentMethodKey, { pct: number; fixedCents: number; minFeeCents: number }> = {
  yappy: { pct: 0.0107, fixedCents: 0, minFeeCents: 2 },
  cuantoapp: { pct: 0.049, fixedCents: 35, minFeeCents: 0 },
  cash: { pct: 0, fixedCents: 0, minFeeCents: 0 }
};

export interface PriceBreakdown {
  netCents: number;
  feeCents: number;
  totalCents: number;
}

// El recargo es POR TRANSACCIÓN: el fijo se aplica una sola vez sobre el neto
// total, no por entrada. precioFinal = (neto + fijo) / (1 − pct), redondeado
// hacia arriba al centavo (igual que el servidor) para que el neto ≥ base.
export function priceBreakdown(tier: TierKey, quantity: number, method: PaymentMethodKey): PriceBreakdown {
  const netCents = TIERS[tier].priceCents * quantity;
  if (netCents <= 0) return { netCents: 0, feeCents: 0, totalCents: 0 };
  const fee = PAYMENT_FEES[method];
  let totalCents = Math.ceil((netCents + fee.fixedCents) / (1 - fee.pct));
  if (totalCents - netCents < fee.minFeeCents) {
    totalCents = netCents + fee.minFeeCents;
  }
  return { netCents, feeCents: totalCents - netCents, totalCents };
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
