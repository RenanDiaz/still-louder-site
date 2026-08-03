// =============================================================================
// Ciclo de vida del evento (autoridad del servidor)
// =============================================================================
// `pricing.ts` decide QUÉ tarifa se puede vender; este módulo decide si el
// evento sigue vivo en absoluto. Son las dos fechas que "archivan" un evento
// terminado sin tocar la base de datos ni las herramientas de staff:
//
//   SALES_END  → no se crean órdenes nuevas ni se reclaman regalos
//   EVENT_END  → la puerta deja de aceptar QR
//
// Espejo cliente en `src/shared/config.ts` (EVENT.salesEnd / EVENT.eventEnd),
// duplicado a propósito: el cliente solo decide qué dibujar, el servidor decide
// qué se permite. Igual que con los precios, el servidor manda.
//
// Al reusar el sistema para el próximo show hay que mover estas dos fechas
// (junto con las de `pricing.ts` y `src/shared/config.ts`) — mientras el
// sistema siga siendo de un solo evento, son el interruptor de apagado.
// =============================================================================

// Fin de la venta: el cierre de la noche del show. Después de esto ya no se
// vende nada, en ninguna tarifa, ni por preventa agotada ni por cupo libre —
// simplemente el evento ya pasó.
const SALES_END_ISO = '2026-08-02T02:00:00-05:00';

// Fin del evento: a partir de aquí la validación en puerta queda congelada.
// No es cosmético, es una protección para reusar el sistema: el payload del QR
// es `WWWY3.<ticket_id>.<sig>` firmado con un TICKET_HMAC_SECRET que no está
// scopeado por evento, así que un ticket `valid` sin usar de este show pasaría
// el gate del PRÓXIMO evento mientras la validación siguiera abierta. Cerrarla
// aquí corta esa vía hasta que los tickets tengan scope por evento.
const EVENT_END_ISO = '2026-08-02T06:00:00-05:00';

/** true cuando la venta del evento ya cerró (no se aceptan órdenes nuevas). */
export function haveSalesEnded(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(SALES_END_ISO).getTime();
}

/** true cuando el evento ya terminó (la puerta no valida más QR). */
export function isEventOver(now: Date = new Date()): boolean {
  return now.getTime() >= new Date(EVENT_END_ISO).getTime();
}
