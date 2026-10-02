import { MAX_QUANTITY_PER_ORDER } from './pricing.js';

// CuantoApp es manual: cada cantidad (1–10) tiene su propio producto OCULTO en
// el catálogo, con el precio ya "grossed-up" (porque el fijo de $0.35 es por
// transacción, no por entrada). El operador crea esos productos una vez y pega
// sus links en CUANTOAPP_PAYMENT_URL_<n>; aquí elegimos el que corresponde a la
// cantidad. CUANTOAPP_PAYMENT_URL (sin sufijo) queda como fallback. El producto
// puede llevar dos precios (preventa/general): el comprador paga el monto exacto
// que le mostramos, y el admin marca el precio de preventa como agotado al
// cerrarse esa etapa.
//
// `||` (no `??`): una variable definida vacía también cae al fallback.

export type CuantoappLinkSource = 'specific' | 'fallback' | 'missing';

export interface CuantoappLink {
  quantity: number;
  /** Nombre de la variable que se usaría para esta cantidad. */
  envVar: string;
  url: string;
  source: CuantoappLinkSource;
}

export function cuantoappLinkFor(quantity: number): string {
  return process.env[`CUANTOAPP_PAYMENT_URL_${quantity}`] || process.env.CUANTOAPP_PAYMENT_URL || '';
}

/** Lo que el comprador recibiría para cada cantidad, y de dónde sale. */
export function listCuantoappLinks(): CuantoappLink[] {
  const fallback = process.env.CUANTOAPP_PAYMENT_URL || '';
  const links: CuantoappLink[] = [];
  for (let quantity = 1; quantity <= MAX_QUANTITY_PER_ORDER; quantity++) {
    const envVar = `CUANTOAPP_PAYMENT_URL_${quantity}`;
    const specific = process.env[envVar] || '';
    if (specific) links.push({ quantity, envVar, url: specific, source: 'specific' });
    else if (fallback) links.push({ quantity, envVar: 'CUANTOAPP_PAYMENT_URL', url: fallback, source: 'fallback' });
    else links.push({ quantity, envVar, url: '', source: 'missing' });
  }
  return links;
}
