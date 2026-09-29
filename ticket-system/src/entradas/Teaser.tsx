import type { PublicEvent } from '../shared/api';
import { BAND_NAME, SOCIAL, formatDotDate } from '../shared/config';

/**
 * Vista TEASER de un evento (status = 'teaser'), p. ej. /halloween-party antes de abrir
 * la venta.
 *
 * REVELAR LO MÍNIMO: la banda, la fecha y una sola acción. Nada de nombre del
 * evento, lugar, precios ni cuenta regresiva — cada línea extra le quita
 * misterio a la fecha. Lo poco que queda se ve tenue (ver teaser.css), pero
 * vive como texto real en el DOM: el degradado es presentación, así que
 * buscadores, lectores de pantalla y el preview del enlace lo leen completo.
 *
 * Al pasar el evento a 'on_sale' desde el admin, la misma URL muestra el flujo
 * de compra (sin redeploy): esta vista deja de dibujarse.
 */
export function Teaser({ event }: { event: PublicEvent }) {
  return (
    <main className="tz-page">
      {/* Bloque "emergiendo": es lo que el degradado deja apenas asomar. */}
      <div className="tz-emerge">
        <p className="tz-band">{BAND_NAME}</p>
        <h1 className="tz-date">
          <time dateTime={event.startsAt}>{formatDotDate(event.startsAt)}</time>
        </h1>
      </div>

      {/* Lo único accionable queda FUERA del bloque tenue: un enlace se tiene
          que poder leer, así que este mantiene contraste suficiente. */}
      <a className="tz-cta" href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
        Avísame
      </a>
    </main>
  );
}
