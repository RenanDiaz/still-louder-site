import { useEffect, useState, type ReactNode } from 'react';
import { getPresaleStatus, getYappyConfig, type PublicEvent } from '../shared/api';
import { setAnalyticsContext, trackPageView } from '../shared/analytics';
import { BAND_NAME, SOCIAL, eventPath } from '../shared/config';

// Paso a paso público para comprar (/como-comprar): una página corta pensada
// para compartir en historias y chats. Sin datos de usuario ni backend propio.
// Como /ayuda, sale del evento ACTUAL (GET /api/presale/status): el enlace del
// paso 1 apunta a la página de ese evento, y los pasos de Yappy solo se muestran
// si el servidor tiene Yappy habilitado (GET /api/yappy/config). Si el evento ya
// pasó, la página lo dice en vez de mandar a comprar. Si los endpoints fallan,
// se muestra la versión genérica (/entradas, con Yappy).
//
// Los textos citan las etiquetas reales del formulario de src/entradas/App.tsx
// («Teléfono (Yappy)», «Método de pago», «Comprar»): si cambian allá, cambiar aquí.

const HOST = 'entradas.still-louder.com';

const IG = (
  <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
    <b>{SOCIAL.instagramHandle}</b>
  </a>
);

function isPast(event: PublicEvent): boolean {
  return event.status === 'archived' || Date.now() >= new Date(event.salesEnd).getTime();
}

function buildSteps(href: string, yappy: boolean): ReactNode[] {
  return [
    <>
      Entra en{' '}
      <a href={href}>
        <b>
          {HOST}
          {href}
        </b>
      </a>
      .
    </>,
    <>
      Llena el formulario con tus datos correctos: cantidad de entradas, nombre completo y correo.
      Revisa bien el correo: <b>ahí te llega tu entrada con el código QR</b>.
    </>,
    yappy ? (
      <>
        En <b>Método de pago</b> selecciona <b>Yappy</b> y escribe en <b>Teléfono (Yappy)</b> el número
        asociado a tu cuenta de Yappy.
      </>
    ) : (
      <>
        En <b>Método de pago</b> elige cómo vas a pagar: tarjeta (CuantoApp) o efectivo.
      </>
    ),
    <>
      Haz clic en <b>Comprar</b>.
    </>,
    yappy ? (
      <>
        Cuando aparezca el botón <b>Pagar con Yappy</b>, haz clic en él y sigue los pasos en tu app de
        Yappy para confirmar el pago. <b>No cierres la página</b> mientras pagas.
      </>
    ) : (
      <>Sigue las instrucciones de pago que te aparecen en pantalla. Te reservamos el cupo 48 horas.</>
    ),
    yappy ? (
      <>
        ¡Listo! La página se actualiza sola al confirmarse el pago y tu entrada con QR llega a tu correo
        en unos minutos.
      </>
    ) : (
      <>¡Listo! Cuando confirmemos tu pago, tu entrada con QR llega a tu correo.</>
    )
  ];
}

export default function App() {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [yappy, setYappy] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getPresaleStatus()
        .then((r) => {
          setEvent(r.event);
          setAnalyticsContext({ event_slug: r.event.slug, event_status: r.event.status });
        })
        .catch(() => setEvent(null)),
      getYappyConfig()
        .then((cfg) => setYappy(cfg.enabled))
        .catch(() => setYappy(true))
    ]).finally(() => {
      setLoaded(true);
      trackPageView();
    });
  }, []);

  useEffect(() => {
    if (event) document.documentElement.dataset.theme = event.theme;
  }, [event]);

  const href = event ? eventPath(event.slug) : '/entradas';
  const past = event ? isPast(event) : false;
  const steps = buildSteps(href, yappy);

  return (
    <div className="tk-page">
      <div className="tk-wrap">
        <p className="tk-kicker tk-reveal">★ paso a paso ★</p>

        <div className="tk-title-block tk-reveal">
          <div className="tk-patch tk-title-patch">
            <h1 className="tk-title">
              <span className="l1">CÓMO</span>
              <span className="l2">COMPRAR</span>
            </h1>
            <div className="tk-byline">
              {event && event.status !== 'teaser' ? `${event.shortName} · ` : ''}by {BAND_NAME}
            </div>
          </div>
        </div>

        {event && past && (
          <div className="tk-closed-notice tk-reveal" role="status">
            <strong>⚡ La venta está cerrada</strong>
            <p>
              {event.name} ya pasó. Cuando anunciemos la próxima fecha, las entradas se venderán otra vez
              así, directamente con la banda. Síguenos en Instagram {IG} para enterarte primero.
            </p>
          </div>
        )}
        {event && event.status === 'teaser' && (
          <div className="tk-closed-notice tk-reveal" role="status">
            <strong>⚡ La venta abre pronto</strong>
            <p>
              Todavía no puedes comprar, pero así será cuando abra. Síguenos en Instagram {IG} para
              enterarte primero.
            </p>
          </div>
        )}

        {!past && (
          <ol className="buy-steps tk-reveal" aria-busy={!loaded}>
            {steps.map((step, i) => (
              <li key={i} className="buy-steps__item">
                <span className="buy-steps__num" aria-hidden="true">
                  {i + 1}
                </span>
                <p className="buy-steps__text">{step}</p>
              </li>
            ))}
          </ol>
        )}

        <section className="help-contact tk-reveal" aria-labelledby="buy-help-title">
          <h2 id="buy-help-title" className="help-contact__title">
            ¿Algo no funcionó?
          </h2>
          <p>
            Revisa las <a href="/ayuda">preguntas frecuentes</a> o escríbenos por Instagram {IG} y te
            ayudamos con tu compra.
          </p>
          {yappy && (
            <p className="help-contact__note">
              ¿Prefieres pagar con tarjeta (CuantoApp) o efectivo? Elígelo en el paso 3 y sigue las
              instrucciones en pantalla; tu entrada llega a tu correo cuando confirmemos el pago.
            </p>
          )}
          <p className="help-contact__note">
            La venta es siempre directa con la banda: no vendemos por intermediarios.
          </p>
        </section>

        {!past && (
          <p className="tk-trust">
            <a href={href}>
              <b>Ir a comprar →</b>
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
