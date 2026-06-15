import type { ReactNode } from 'react';
import { EVENT, SOCIAL } from '../shared/config';

// Cara pública de soporte al cliente (/ayuda): preguntas frecuentes + canales
// oficiales. Es 100% estática (sin backend ni datos de usuario): el autoservicio
// de reenvío de entradas NO vive aquí — quien pierde su correo escribe por los
// canales y el staff lo reenvía desde el backoffice (/support). Reutiliza el
// tema público de /entradas para no romper la identidad entre comprar y pedir
// ayuda.

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
    q: '¿Cuándo y dónde es el evento?',
    a: (
      <p>
        <b>{EVENT.name}</b> es el <b>1 de agosto a las 8:00 PM</b> en {EVENT.venue}. Una noche de
        covers de las bandas que nos inspiraron, por {EVENT.band}. Es un evento{' '}
        <b>solo para mayores de 18 años</b>: lleva tu identificación.
      </p>
    )
  },
  {
    q: '¿Cuánto cuestan las entradas?',
    a: (
      <p>
        Preventa a <b>$6</b> mientras haya cupo, y <b>$8</b> el día del evento. Te aplicamos
        automáticamente el mejor precio disponible al momento de comprar. Según el método de pago
        puede sumarse un pequeño cargo por servicio, que siempre verás reflejado en el total antes
        de confirmar.
      </p>
    )
  },
  {
    q: '¿Cómo compro mis entradas?',
    a: (
      <p>
        En línea, directamente con la banda en{' '}
        <a href="/entradas">
          <b>entradas.stilllouder.space</b>
        </a>
        . No vendemos por intermediarios. También podrás comprar en la puerta el día del evento al
        precio general ($8), sujeto a disponibilidad.
      </p>
    )
  },
  {
    q: '¿Qué métodos de pago aceptan?',
    a: (
      <p>
        Yappy, tarjeta (CuantoApp) y efectivo. Con <b>Yappy</b> el pago se confirma al instante; con
        tarjeta o efectivo confirmamos el pago manualmente y, en cuanto lo registramos, te llegan las
        entradas por correo.
      </p>
    )
  },
  {
    q: '¿Cómo recibo mis entradas?',
    a: (
      <p>
        Cuando confirmamos tu pago, te enviamos un correo con tu(s) código(s) QR — uno por entrada.
        Desde ese mismo correo puedes agregarlas a Google Wallet. Cada código QR es válido para una
        sola admisión.
      </p>
    )
  },
  {
    q: 'No me llegó el correo con las entradas. ¿Qué hago?',
    a: (
      <>
        <p>
          Primero revisa las carpetas de spam y promociones; busca el correo{' '}
          <i>«Tu entrada para WWWY3 — Still Louder»</i>. Si pagaste con tarjeta o efectivo, recuerda
          que el correo llega cuando confirmamos el pago, no al instante.
        </p>
        <p>
          Si pasó un tiempo razonable y sigue sin aparecer, escríbenos por Instagram {IG} con el{' '}
          <b>nombre y correo que usaste</b> al comprar (y tu número de orden si lo tienes) y te lo
          reenviamos.
        </p>
      </>
    )
  },
  {
    q: '¿Puedo darle mi entrada a otra persona?',
    a: (
      <p>
        Sí. Quien presente el código QR en la puerta entra, así que puedes transferir tu entrada:
        solo envíale el QR a la persona correcta y asegúrate de que <b>una sola persona use cada
        código</b> (sirve una única vez). Recuerda que el evento es solo para mayores de 18 años.
      </p>
    )
  },
  {
    q: '¿Hay reembolsos o cambios?',
    a: (
      <p>
        No. Todas las compras son finales: no hacemos reembolsos ni cambios. Si tuviste algún
        problema con tu orden, escríbenos por {IG} y vemos cómo ayudarte.
      </p>
    )
  },
  {
    q: '¿Qué necesito para entrar al evento?',
    a: (
      <p>
        Tu código QR (en el correo o en Google Wallet) y tu identificación, ya que el evento es solo
        para mayores de 18 años. Te recomendamos tener el QR listo antes de llegar a la puerta.
      </p>
    )
  },
  {
    q: 'Perdí mi número de orden, ¿es un problema?',
    a: (
      <p>
        No. Lo que importa para entrar es el correo con tu código QR. Si necesitas ayuda con tu
        compra, escríbenos por {IG} con el nombre y correo que usaste y te ubicamos.
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
            Compra siempre directamente con la banda. No vendemos por intermediarios.
          </p>
        </section>

        <p className="tk-trust">
          <a href="/entradas">
            <b>← Volver a comprar entradas</b>
          </a>
        </p>
      </div>
    </div>
  );
}
