// Client-side display config. NO secrets here — this is bundled into the
// browser. Prices shown here are for display only; the server is authoritative.

// Los datos de cada evento (nombre, lugar, fechas, estado, tema y precios) ya
// NO viven aquí: los sirve `GET /api/presale/status?event=<slug>` desde la tabla
// `events` (migración 0011). El cliente solo dibuja; el servidor decide.

export const BAND_NAME = 'Still Louder';

// GA4 — misma propiedad que el main site (public/assets/js/config.js). Es
// público; el secreto del Measurement Protocol vive solo en el servidor.
export const GA_MEASUREMENT_ID = 'G-ZZ4XG8CD88';

// Canales oficiales de la banda. El Instagram es el canal principal; el enlace
// usa ig.me/m/ para abrir un mensaje directo (DM) en vez del perfil.
export const SOCIAL = {
  instagramHandle: '@still_louder',
  instagramDm: 'https://ig.me/m/still_louder'
} as const;

export type TierKey = 'preventa' | 'general';

// Display labels for EVERY tier that can appear on a ticket, including the
// admin-only 'cortesia'/'regalo' (which never show up in the purchase flow).
export const TIER_LABELS: Record<string, string> = {
  preventa: 'Preventa',
  general: 'General',
  cortesia: 'Cortesía',
  regalo: 'Regalo'
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
export function priceBreakdown(unitPriceCents: number, quantity: number, method: PaymentMethodKey): PriceBreakdown {
  const netCents = unitPriceCents * quantity;
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

/** "$6" / "$6.50" — precio de tarifa sin centavos cuando es entero. */
export function formatPriceLabel(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatMoney(cents);
}

const PANAMA = 'America/Panama';

/** "31 de octubre" en hora de Panamá. */
export function formatEventDay(iso: string): string {
  return new Intl.DateTimeFormat('es-PA', { day: 'numeric', month: 'long', timeZone: PANAMA }).format(new Date(iso));
}

/** "8:00 p. m." en hora de Panamá. */
export function formatEventTime(iso: string): string {
  return new Intl.DateTimeFormat('es-PA', { hour: 'numeric', minute: '2-digit', timeZone: PANAMA }).format(
    new Date(iso)
  );
}

/** "31.10.2026" (formato del teaser). */
export function formatDotDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: PANAMA
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}
