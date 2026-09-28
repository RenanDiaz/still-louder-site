import { useEffect, useState, type ReactNode } from 'react';
import { getPresaleStatus, type PublicEvent } from '../shared/api';
import { BAND_NAME, SOCIAL, formatEventDay, formatEventTime } from '../shared/config';

// Cara pública de soporte al cliente (/ayuda): preguntas frecuentes + canales
// oficiales. Sin datos de usuario: el autoservicio de reenvío de entradas NO
// vive aquí — quien pierde su correo escribe por los canales y el staff lo
// reenvía desde el backoffice (/support). Reutiliza el tema público de
// /entradas (y el tema del evento) para no romper la identidad entre comprar y
// pedir ayuda.
//
// La copia sale del evento ACTUAL (el mismo que muestra /entradas, vía
// GET /api/presale/status): en venta → cómo comprar; teaser → la venta aún no
// abre; pasado/archivado → consultas post-show. Una línea cubre las compras de
// shows anteriores. Si el endpoint falla, se muestra la versión sin evento.

const IG = (
  <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
    <b>{SOCIAL.instagramHandle}</b>
  </a>
);

type Phase = 'teaser' | 'selling' | 'past' | 'unknown';

function phaseOf(event: PublicEvent | null): Phase {
  if (!event) return 'unknown';
  if (event.status === 'teaser') return 'teaser';
  if (event.status === 'archived' || Date.now() >= new Date(event.salesEnd).getTime()) return 'past';
  return 'selling';
}

function whenWhere(event: PublicEvent): ReactNode {
  return (
    <>
      <b>
        {formatEventDay(event.startsAt)} a las {formatEventTime(event.startsAt)}
      </b>
      {event.venue ? <> en {event.venue}</> : null}
    </>
  );
}

interface Faq {
  q: string;
  a: ReactNode;
}

function buildFaqs(event: PublicEvent | null, phase: Phase): Faq[] {
  const emailSubject = event ? `Tu entrada para ${event.shortName} — Still Louder` : 'Tu entrada para … — Still Louder';
  const faqs: Faq[] = [];

  if (event && phase === 'selling') {
    faqs.push(
      {
        q: '¿Cómo compro entradas?',
        a: (
          <p>
            Aquí mismo, en{' '}
            <a href="/entradas">
              <b>entradas.still-louder.com</b>
            </a>
            , directamente con la banda. Pagas con Yappy, tarjeta (CuantoApp) o efectivo y tu entrada
            con código QR llega a tu correo al confirmarse el pago.
          </p>
        )
      },
      {
        q: '¿Cuándo y dónde es el show?',
        a: (
          <p>
            <b>{event.name}</b> es el {whenWhere(event)}.
          </p>
        )
      },
      {
        q: '¿Cómo llega mi entrada?',
        a: (
          <p>
            Por correo, con un código QR por cada entrada. Preséntalo en la puerta desde el teléfono o
            impreso: cada código es válido para <b>una sola admisión</b>. Con efectivo o tarjeta, la
            entrada se envía cuando confirmamos el pago (reservamos tu cupo 48 horas).
          </p>
        )
      }
    );
  } else if (event && phase === 'teaser') {
    faqs.push({
      q: '¿Ya puedo comprar entradas?',
      a: (
        <p>
          Todavía no: la venta abre pronto y será aquí mismo, en <b>entradas.still-louder.com</b>,
          directamente con la banda. Para enterarte primero, síguenos en Instagram {IG}.
        </p>
      )
    });
  } else if (event && phase === 'past') {
    faqs.push(
      {
        q: '¿Puedo comprar entradas todavía?',
        a: (
          <p>
            No. <b>{event.name}</b> fue el {whenWhere(event)} y la venta está cerrada. Cuando
            anunciemos la próxima fecha, las entradas se venderán otra vez aquí mismo, directamente
            con la banda. Para enterarte primero, síguenos en Instagram {IG}.
          </p>
        )
      },
      {
        q: 'Compré entradas y no las usé. ¿Sirven para el próximo show?',
        a: (
          <p>
            No. Cada entrada es válida solo para el evento para el que se compró, así que los códigos
            QR de {event.shortName} ya no admiten a nadie. El próximo show tendrá su propia venta y
            sus propias entradas.
          </p>
        )
      }
    );
  }

  faqs.push(
    {
      q: '¿Hay reembolsos o cambios?',
      a: (
        <p>
          No. Todas las compras son finales: no hacemos reembolsos ni cambios. Una vez comprada, la
          entrada es tuya — úsala, regálala o transfiérela. Si hubo algún problema con tu orden,
          escríbenos por {IG} y vemos cómo ayudarte.
        </p>
      )
    },
    {
      q: 'Nunca me llegó el correo con mis entradas. ¿Qué hago?',
      a: (
        <>
          <p>
            Primero revisa las carpetas de spam y promociones; busca el correo{' '}
            <i>«{emailSubject}»</i>.
          </p>
          <p>
            Si sigue sin aparecer, escríbenos por Instagram {IG} con el{' '}
            <b>nombre y correo que usaste</b> al comprar (y tu número de orden si lo tienes) y te lo
            reenviamos.
          </p>
        </>
      )
    },
    {
      q: 'Tengo una duda sobre un cobro. ¿Con quién hablo?',
      a: (
        <p>
          Con nosotros directamente, por {IG}. Cuéntanos el <b>nombre y correo</b> con los que
          compraste, el método de pago que usaste y el monto, y lo revisamos contra nuestros
          registros. No vendemos por intermediarios: cualquier cobro legítimo sale de nuestra propia
          venta o de la pasarela de pago que elegiste (Yappy o CuantoApp).
        </p>
      )
    },
    {
      q: 'Perdí mi número de orden, ¿es un problema?',
      a: (
        <p>
          No. Nos basta con el nombre y el correo que usaste al comprar: escríbenos por {IG} y te
          ubicamos en nuestros registros.
        </p>
      )
    },
    {
      q: 'Tengo una consulta sobre una compra de un show anterior.',
      a: (
        <p>
          También te ayudamos: escríbenos por {IG} con el nombre y correo de la compra y el show al
          que era. Tenemos el registro de todas las órdenes.
        </p>
      )
    }
  );
  return faqs;
}

export default function App() {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getPresaleStatus()
      .then((r) => setEvent(r.event))
      .catch(() => setEvent(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (event) document.documentElement.dataset.theme = event.theme;
  }, [event]);

  const phase = phaseOf(event);
  const faqs = buildFaqs(event, phase);

  return (
    <div className="tk-page">
      <div className="tk-wrap">
        <p className="tk-kicker tk-reveal">★ ¿en qué te ayudamos? ★</p>

        <div className="tk-title-block tk-reveal">
          <div className="tk-patch tk-title-patch">
            <h1 className="tk-title">
              <span className="l1">CENTRO DE</span>
              <span className="l2">AYUDA</span>
            </h1>
            <div className="tk-byline">
              {event && phase !== 'teaser' ? `${event.shortName} · ` : ''}by {BAND_NAME}
            </div>
          </div>
        </div>

        {event && phase === 'past' && (
          <div className="tk-closed-notice tk-reveal" role="status">
            <strong>⚡ El show ya pasó</strong>
            <p>
              {event.name} fue el {whenWhere(event)} y la venta está cerrada. Esta página queda para
              consultas sobre compras de ese evento y de shows anteriores.
            </p>
          </div>
        )}

        <p className="tk-meta tk-reveal">Preguntas frecuentes</p>

        <div className="help-faq tk-reveal" aria-busy={!loaded}>
          {faqs.map((faq) => (
            <details key={faq.q} className="help-faq__item">
              <summary className="help-faq__q">{faq.q}</summary>
              <div className="help-faq__a">{faq.a}</div>
            </details>
          ))}
        </div>

        <section className="help-contact tk-reveal" aria-labelledby="help-contact-title">
          <h2 id="help-contact-title" className="help-contact__title">
            ¿Aún tienes dudas?
          </h2>
          <p>Escríbenos por nuestro canal oficial y te ayudamos con tu compra o tus entradas:</p>
          <p className="help-contact__channel">
            <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
              Instagram <b>{SOCIAL.instagramHandle}</b>
            </a>
          </p>
          <p className="help-contact__note">
            Ahí también anunciamos las próximas fechas. La venta es siempre directa con la banda: no
            vendemos por intermediarios.
          </p>
        </section>

        <p className="tk-trust">
          <a href="/entradas">
            <b>← Volver a la página del evento</b>
          </a>
        </p>
      </div>
    </div>
  );
}
