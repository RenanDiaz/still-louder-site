import type { ReactNode } from 'react';
import { EVENT, SOCIAL } from '../shared/config';

// Cara pública de soporte al cliente (/ayuda): preguntas frecuentes + canales
// oficiales. Es 100% estática (sin backend ni datos de usuario): el autoservicio
// de reenvío de entradas NO vive aquí — quien pierde su correo escribe por los
// canales y el staff lo reenvía desde el backoffice (/support). Reutiliza el
// tema público de /entradas para no romper la identidad entre comprar y pedir
// ayuda.
//
// POST-EVENTO: el show ya pasó, así que la copia está en pasado y las preguntas
// de venta (cómo comprar, métodos de pago) se reemplazaron por el aviso de
// cierre. Lo que queda son las consultas que siguen llegando después del show:
// cobros, entradas que no llegaron, reembolsos. Al anunciar el próximo evento
// hay que reescribir estos textos (y las fechas de `api/_lib/event.ts`) —
// mientras el sistema sea de un solo evento, esta copia es manual.

const IG = (
  <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
    <b>{SOCIAL.instagramHandle}</b>
  </a>
);

interface Faq {
  q: string;
  a: ReactNode;
}

const FAQS: Faq[] = [
  {
    q: '¿Puedo comprar entradas todavía?',
    a: (
      <p>
        No. <b>{EVENT.name}</b> fue el <b>1 de agosto en {EVENT.venue}</b> y la venta está cerrada.
        Cuando anunciemos la próxima fecha, las entradas se venderán otra vez aquí mismo, en{' '}
        <b>entradas.stilllouder.space</b>, directamente con la banda. Para enterarte primero,
        síguenos en Instagram {IG}.
      </p>
    )
  },
  {
    q: '¿Cuándo y dónde fue el evento?',
    a: (
      <p>
        <b>{EVENT.name}</b> fue el <b>1 de agosto a las 8:00 PM</b> en {EVENT.venue}: una noche de
        covers de las bandas que nos inspiraron, por {EVENT.band}.
      </p>
    )
  },
  {
    q: 'Compré entradas y no las usé. ¿Sirven para el próximo show?',
    a: (
      <p>
        No. Cada entrada es válida solo para el evento para el que se compró, así que los códigos QR
        de {EVENT.shortName} ya no admiten a nadie. El próximo show tendrá su propia venta y sus
        propias entradas.
      </p>
    )
  },
  {
    q: '¿Hay reembolsos o cambios?',
    a: (
      <p>
        No. Todas las compras son finales: no hacemos reembolsos ni cambios, y eso sigue aplicando
        ahora que el evento pasó. Si hubo algún problema con tu orden, escríbenos por {IG} y vemos
        cómo ayudarte.
      </p>
    )
  },
  {
    q: 'Nunca me llegó el correo con mis entradas. ¿Qué hago?',
    a: (
      <>
        <p>
          Primero revisa las carpetas de spam y promociones; busca el correo{' '}
          <i>«Tu entrada para WWWY3 — Still Louder»</i>.
        </p>
        <p>
          Si sigue sin aparecer y quieres el comprobante de tu compra, escríbenos por Instagram {IG}{' '}
          con el <b>nombre y correo que usaste</b> al comprar (y tu número de orden si lo tienes) y
          te lo reenviamos.
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
        registros. No vendimos por intermediarios: cualquier cobro legítimo salió de nuestra propia
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
  }
];

export default function App() {
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
            <div className="tk-byline">{EVENT.shortName} · by {EVENT.band}</div>
          </div>
        </div>

        <div className="tk-closed-notice tk-reveal" role="status">
          <strong>⚡ El show ya pasó</strong>
          <p>
            {EVENT.name} fue el <b>1 de agosto en {EVENT.venue}</b> y la venta está cerrada. Esta
            página queda para consultas sobre compras de ese evento.
          </p>
        </div>

        <p className="tk-meta tk-reveal">Preguntas frecuentes</p>

        <div className="help-faq tk-reveal">
          {FAQS.map((faq) => (
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
          <p>
            Escríbenos por nuestro canal oficial y te ayudamos con tu compra o tus entradas:
          </p>
          <p className="help-contact__channel">
            <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
              Instagram <b>{SOCIAL.instagramHandle}</b>
            </a>
          </p>
          <p className="help-contact__note">
            Ahí también anunciamos la próxima fecha. Cuando haya venta, es siempre directa con la
            banda: no vendemos por intermediarios.
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
