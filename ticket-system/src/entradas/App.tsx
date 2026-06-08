import { useEffect, useMemo, useState } from 'react';
import {
  createOrder,
  getPresaleStatus,
  type CreateOrderResponse,
  type PresaleStatusResponse
} from '../shared/api';
import { EVENT, PAYMENT_METHODS, TIERS, type TierKey } from '../shared/config';
import { Countdown } from './Countdown';

type Method = (typeof PAYMENT_METHODS)[number]['value'];

export default function App() {
  const [presale, setPresale] = useState<PresaleStatusResponse | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tier, setTier] = useState<TierKey>('preventa');
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<Method>('cuantoapp');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<CreateOrderResponse | null>(null);

  useEffect(() => {
    getPresaleStatus().then(setPresale).catch(() => setPresale(null));
  }, []);

  const presaleSoldOut = presale?.soldOut ?? false;
  const total = useMemo(() => TIERS[tier].priceCents * quantity, [tier, quantity]);

  // If presale is sold out, default the buyer to general.
  useEffect(() => {
    if (presaleSoldOut && tier === 'preventa') setTier('general');
  }, [presaleSoldOut, tier]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await createOrder({
        buyer_name: name,
        buyer_email: email,
        buyer_phone: phone || undefined,
        tier,
        quantity,
        payment_method: method
      });
      setConfirmation(result);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'presale_sold_out') {
        setError('La preventa se agotó. Refresca la página para comprar entrada general.');
        getPresaleStatus().then(setPresale).catch(() => {});
      } else if (code === 'invalid_email') {
        setError('Revisa el correo: parece inválido.');
      } else {
        setError('No pudimos crear tu orden. Inténtalo de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return <Confirmation data={confirmation} onReset={() => setConfirmation(null)} />;
  }

  return (
    <div className="tk-page">
      <Decorations />
      <div className="tk-wrap">
        <p className="tk-kicker tk-reveal">★ {EVENT.band} presenta · tributo emo ♥ ★</p>

        {/* Hero: identidad del evento sobre parche de papel inclinado */}
        <div className="tk-title-block tk-reveal">
          <div className="tk-patch tk-title-patch">
            <h1 className="tk-title">
              <span className="l1">WHEN WE</span>
              <span className="l2">
                WERE YOUNG <span className="num">3</span>
              </span>
            </h1>
            <div className="tk-byline">by {EVENT.band}</div>
          </div>
        </div>

        <p className="tk-meta tk-reveal">
          Una noche de covers de las bandas que nos inspiraron
        </p>

        {/* Precios + fecha como stickers de collage */}
        <div className="tk-prices">
          <div className="tk-badge tk-patch tk-patch--dark tk-reveal" style={{ transform: 'rotate(-4deg)' }}>
            <small>BOLETOS</small>
            <span className="amt">{TIERS.preventa.priceLabel}</span>
            <small>PREVENTA</small>
          </div>
          <div className="tk-date tk-patch tk-reveal" style={{ transform: 'rotate(1.5deg)' }}>
            <span className="day">1 AGO</span>
            <span className="venue">{EVENT.venue} ⚡</span>
          </div>
          <div className="tk-badge tk-patch tk-patch--dark tk-reveal" style={{ transform: 'rotate(4deg)' }}>
            <small>BOLETOS</small>
            <span className="amt">{TIERS.general.priceLabel}</span>
            <small>EL DÍA</small>
          </div>
        </div>

        {/* Countdown + urgencia */}
        <div className="tk-reveal">
          <Countdown />
        </div>
        <PresaleIndicator presale={presale} />

        {/* Formulario: temático pero LEGIBLE (sin filtro rasgado en inputs) */}
        <form className="tk-form tk-reveal" onSubmit={handleSubmit}>
          <h2 className="tk-form__title">Compra tus entradas</h2>

          <label htmlFor="tier">Tipo de entrada</label>
          <select id="tier" value={tier} onChange={(e) => setTier(e.target.value as TierKey)}>
            <option value="preventa" disabled={presaleSoldOut}>
              {TIERS.preventa.label} — {TIERS.preventa.priceLabel}
              {presaleSoldOut ? ' (agotada)' : ''}
            </option>
            <option value="general">
              {TIERS.general.label} — {TIERS.general.priceLabel}
            </option>
          </select>

          <label htmlFor="quantity">Cantidad</label>
          <select
            id="quantity"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <label htmlFor="name">Nombre completo</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />

          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <p className="tk-hint">Aquí enviaremos tu entrada con el código QR.</p>

          <label htmlFor="phone">Teléfono (opcional)</label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />

          <label htmlFor="method">Método de pago</label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {error && (
            <div className="tk-alert tk-alert--error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="tk-cta" disabled={submitting}>
            {submitting ? 'Procesando…' : `Comprar — $${(total / 100).toFixed(2)} ⚡`}
          </button>
        </form>

        {/* Confianza: canales oficiales */}
        <p className="tk-trust">
          Compra directamente con la banda. Canales oficiales: <b>@stilllouder</b>. No vendemos por
          intermediarios.
        </p>
      </div>
    </div>
  );
}

/** Estrellas y rayos decorativos (puramente ornamentales). */
function Decorations() {
  return (
    <>
      <div className="tk-deco" style={{ top: 70, left: -6, transform: 'rotate(-15deg)' }} aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" focusable="false">
          <path fill="#ff2e93" d="M12 2l2.6 6.6L22 9.3l-5 4.7L18.5 22 12 18l-6.5 4L7 14 2 9.3l7.4-.7z" />
        </svg>
      </div>
      <div className="tk-deco" style={{ top: 168, right: -4, transform: 'rotate(12deg)' }} aria-hidden="true">
        <svg width="32" height="38" viewBox="0 0 12 22" focusable="false">
          <path fill="#15121c" d="M7 0L0 12h4l-2 10 8-13H6z" />
        </svg>
      </div>
    </>
  );
}

function PresaleIndicator({ presale }: { presale: PresaleStatusResponse | null }) {
  if (!presale) return null;
  if (presale.soldOut) {
    return (
      <p className="tk-stock tk-stock--soldout">
        preventa agotada — entrada general el día del evento ★
      </p>
    );
  }
  return (
    <p className="tk-stock">
      ★ quedan <b>{presale.available}</b> entradas de preventa ★
    </p>
  );
}

function Confirmation({ data, onReset }: { data: CreateOrderResponse; onReset: () => void }) {
  return (
    <div className="tk-page">
      <Decorations />
      <div className="tk-wrap">
        <p className="tk-kicker tk-reveal">★ ¡nos vemos en {EVENT.venue}! ♥ ★</p>

        <div className="tk-title-block tk-reveal">
          <div className="tk-patch tk-title-patch">
            <h1 className="tk-title">
              <span className="l1">¡ORDEN</span>
              <span className="l2">CREADA!</span>
            </h1>
            <div className="tk-byline">{EVENT.shortName} · by {EVENT.band}</div>
          </div>
        </div>

        <div className="tk-form tk-success tk-reveal">
          <p style={{ fontSize: 16 }}>
            Reservamos {data.quantity} {data.quantity === 1 ? 'entrada' : 'entradas'} por un total de{' '}
            <strong>{data.payment.amount}</strong>.
          </p>

          <div className="tk-alert tk-alert--success" style={{ textAlign: 'left' }}>
            <strong>Siguiente paso — {data.payment.method === 'cash' ? 'Efectivo' : 'Pago'}</strong>
            <p style={{ margin: 0 }}>{data.payment.note}</p>
            {data.payment.link && (
              <p style={{ margin: '8px 0 0' }}>
                <a href={data.payment.link} target="_blank" rel="noopener noreferrer">
                  Ir a pagar →
                </a>
              </p>
            )}
          </div>

          <p className="tk-success__order">
            Tu entrada con el código QR llegará por correo en cuanto confirmemos el pago. Guarda tu
            número de orden: <code>{data.orderId}</code>
          </p>

          <button className="tk-btn-secondary" onClick={onReset}>
            Comprar otra entrada
          </button>
        </div>

        <p className="tk-trust">
          ¿Dudas? Escríbenos por nuestros canales oficiales: <b>@stilllouder</b>.
        </p>
      </div>
    </div>
  );
}
