import { NEXT_EVENT, SOCIAL } from '../shared/config';

/**
 * Teaser del show del 31 de octubre de 2026 (/31-10).
 *
 * Esta es la dirección donde vivirá el formulario de compra de ese show, pero
 * todavía no hay nada que vender: ni tarifas, ni cupo, ni evento en la base de
 * datos. Por eso la página es 100% estática — no llama a ningún endpoint — y
 * revela solo la fecha. El archivo de WWWY3 sigue intacto en /entradas.
 *
 * REVELAR LO MÍNIMO: aquí queda la fecha, la banda y una sola acción. Nada de
 * kicker, cuenta regresiva, copy de venta ni enlace a /ayuda — quien tiene
 * dudas de una compra de WWWY3 no llega por este path, y cada línea extra le
 * quita misterio a la fecha. Lo poco que queda se ve tenue (ver teaser.css),
 * pero vive como texto real en el DOM: el degradado es presentación, así que
 * buscadores, lectores de pantalla y el preview del enlace lo leen completo.
 *
 * Al abrir la venta: reemplazar este componente por el flujo de compra real
 * (una vez que el ticket-system maneje múltiples eventos) y dejar /31-10 como
 * el path público del show, con su slug definitivo apuntando aquí por rewrite.
 */
export default function App() {
  return (
    <main className="tz-page">
      {/* Bloque "emergiendo": es lo que el degradado deja apenas asomar. */}
      <div className="tz-emerge">
        <p className="tz-band">Still Louder</p>
        <h1 className="tz-date">
          <time dateTime="2026-10-31">{NEXT_EVENT.dateLabel}</time>
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
