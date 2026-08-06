import { NEXT_EVENT, SOCIAL } from '../shared/config';

/**
 * Teaser del show del 31 de octubre de 2026 (/31-10).
 *
 * Esta es la dirección donde vivirá el formulario de compra de ese show, pero
 * todavía no hay nada que vender: ni tarifas, ni cupo, ni evento en la base de
 * datos. Por eso la página es 100% estática — no llama a ningún endpoint — y
 * revela solo la fecha. El archivo de WWWY3 sigue intacto en /entradas.
 *
 * Al abrir la venta: reemplazar este componente por el flujo de compra real
 * (una vez que el ticket-system maneje múltiples eventos) y dejar /31-10 como
 * el path público del show, con su slug definitivo apuntando aquí por rewrite.
 */
export default function App() {
  return (
    <main className="tz-page">
      <p className="tz-band tz-reveal">Still Louder</p>

      <p className="tz-date tz-reveal">
        <time dateTime="2026-10-31">{NEXT_EVENT.dateLabel}</time>
      </p>
      <p className="tz-kicker tz-reveal">Noche de Halloween</p>

      <hr className="tz-rule" />

      <p className="tz-soon tz-reveal">Pronto</p>
      <p className="tz-copy tz-reveal">
        Aquí se van a vender las entradas. Todavía no — guarda el enlace y aparta la noche.
      </p>
      <Countdown />

      <a className="tz-cta tz-reveal" href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
        Avísame primero
      </a>

      <p className="tz-foot">
        Vendemos directamente con la banda, sin intermediarios. ¿Consultas sobre una compra del show
        anterior? Revisa la <a href="/ayuda">ayuda</a>.
      </p>
    </main>
  );
}

/**
 * Cuenta regresiva en días. Se calcula una sola vez al montar: no hay reloj ni
 * intervalo porque la resolución es diaria y la página es efímera. Pasada la
 * fecha no muestra nada — para entonces esta superficie ya no debería existir.
 */
function Countdown() {
  const days = Math.ceil((new Date(NEXT_EVENT.dateISO).getTime() - Date.now()) / 86400000);
  if (!Number.isFinite(days) || days <= 0) return null;

  return (
    <p className="tz-countdown" role="status">
      {days === 1 ? 'falta 1 día' : `faltan ${days} días`}
    </p>
  );
}
