import { useEffect, useState } from 'react';
import {
  createOrder,
  getOrderStatus,
  getPresaleStatus,
  getYappyConfig,
  type CreateOrderResponse,
  type PresaleStatusResponse,
  type YappyConfigResponse
} from '../shared/api';
import { EVENT, PAYMENT_METHODS, TIERS, type TierKey } from '../shared/config';
import { Countdown } from './Countdown';
import { YappyButton } from './YappyButton';

type Method = (typeof PAYMENT_METHODS)[number]['value'];

// A pending Yappy order survives a refresh (the Yappy modal's countdown dies
// with the page, but the IPN doesn't need the browser — restoring the
// confirmation lets polling pick the truth back up).
const PENDING_ORDER_KEY = 'wwwy3.pendingYappyOrder';

function restorePendingOrder(): CreateOrderResponse | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ORDER_KEY);
    return raw ? (JSON.parse(raw) as CreateOrderResponse) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [presale, setPresale] = useState<PresaleStatusResponse | null>(null);
  const [yappyCfg, setYappyCfg] = useState<YappyConfigResponse | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // Presale is over once its date passes (independent of the async cupo check).
  // State (not a constant) so a server-side `presale_ended` rejection — e.g.
  // a buyer with a skewed clock — can flip it too.
  const [presaleEnded, setPresaleEnded] = useState(
    () => Date.now() >= new Date(EVENT.presaleEnd).getTime()
  );
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<Method>('cuantoapp');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<CreateOrderResponse | null>(restorePendingOrder);

  useEffect(() => {
    getPresaleStatus().then(setPresale).catch(() => setPresale(null));
    getYappyConfig()
      .then((cfg) => {
        setYappyCfg(cfg);
        // Yappy is the flagship method: preselect it when available.
        if (cfg.enabled) setMethod('yappy');
      })
      .catch(() => setYappyCfg({ enabled: false, cdnUrl: null }));
  }, []);

  // Persist pending Yappy confirmations across refreshes (see PENDING_ORDER_KEY).
  useEffect(() => {
    try {
      if (confirmation && confirmation.payment.method === 'yappy') {
        sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(confirmation));
      } else {
        sessionStorage.removeItem(PENDING_ORDER_KEY);
      }
    } catch {
      // storage unavailable (private mode) — refresh just loses the view
    }
  }, [confirmation]);

  const presaleSoldOut = presale?.soldOut ?? false;
  // Preventa can only be bought while its date is open AND cupo remains.
  const presaleAvailable = !presaleEnded && !presaleSoldOut;
  // The tier is never the buyer's choice: while presale is available everyone
  // pays the cheaper presale price; once it ends or sells out, general applies.
  const tier: TierKey = presaleAvailable ? 'preventa' : 'general';
  const total = TIERS[tier].priceCents * quantity;

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
        setError('La preventa se agotó. Ahora aplica el precio general — revisa el total antes de continuar.');
        // Flip availability locally right away (works even if the status fetch
        // failed earlier); the refetch then refines the real count.
        setPresale((p) => ({
          available: 0,
          capacity: p?.capacity ?? 0,
          stage2Active: p?.stage2Active ?? false,
          soldOut: true
        }));
        getPresaleStatus().then(setPresale).catch(() => {});
      } else if (code === 'presale_ended') {
        setError('La preventa terminó. Ahora aplica el precio general — revisa el total antes de continuar.');
        setPresaleEnded(true);
      } else if (code === 'presale_available') {
        // The server knows better: presale is open again (freed cupo or our
        // clock was ahead). Flip back so the buyer pays the cheaper price.
        setError('¡La preventa está disponible! Aplica su precio — revisa el total antes de continuar.');
        setPresaleEnded(false);
        setPresale((p) => (p ? { ...p, available: Math.max(p.available, 1), soldOut: false } : p));
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

  const availableMethods = PAYMENT_METHODS.filter(
    (m) => m.value !== 'yappy' || (yappyCfg?.enabled ?? false)
  );

  if (confirmation) {
    return (
      <Confirmation
        data={confirmation}
        yappyCdnUrl={yappyCfg?.cdnUrl ?? null}
        onReset={() => setConfirmation(null)}
      />
    );
  }

  return (
    <div className="tk-page">
      <Decorations />
      <div className="tk-wrap">
        {/* Hero: arte del flyer oficial sobre parche de papel inclinado. Sigue
            siendo el h1 de la página: el alt lleva el texto que antes era visible. */}
        <div className="tk-title-block tk-reveal">
          <div className="tk-patch tk-title-patch tk-title-patch--art">
            <h1 className="tk-title-art">
              <img
                src="/wwwy3-title.webp"
                alt={`${EVENT.band} presenta: ${EVENT.name}`}
                width={984}
                height={543}
              />
            </h1>
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
        <PresaleIndicator presale={presale} presaleEnded={presaleEnded} />

        {/* Formulario: temático pero LEGIBLE (sin filtro rasgado en inputs) */}
        <form className="tk-form tk-reveal" onSubmit={handleSubmit}>
          <h2 className="tk-form__title">Compra tus entradas</h2>

          {/* La tarifa no se elige: se aplica sola la mejor disponible. */}
          <span className="tk-label" id="tier-label">
            Tipo de entrada
          </span>
          <p className="tk-tier" aria-labelledby="tier-label" aria-live="polite">
            <span className="tk-tier__name">{TIERS[tier].label}</span>
            <strong className="tk-tier__price">{TIERS[tier].priceLabel}</strong>
          </p>
          <p className="tk-hint">
            {presaleAvailable
              ? 'Te aplicamos automáticamente el precio de preventa mientras esté disponible.'
              : presaleEnded
                ? 'La preventa terminó: las entradas se venden al precio general.'
                : 'La preventa se agotó: las entradas se venden al precio general.'}
          </p>

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

          <label htmlFor="phone">{method === 'yappy' ? 'Teléfono (Yappy)' : 'Teléfono (opcional)'}</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required={method === 'yappy'}
          />
          {method === 'yappy' && (
            <p className="tk-hint">El número panameño asociado a tu cuenta de Yappy.</p>
          )}

          <label htmlFor="method">Método de pago</label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            {availableMethods.map((m) => (
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

          <p className="tk-price-summary" aria-live="polite">
            <span className="tk-price-summary__tier">{TIERS[tier].label}</span>
            <span className="tk-price-summary__calc">
              {TIERS[tier].priceLabel} × {quantity}
            </span>
            <strong className="tk-price-summary__total">${(total / 100).toFixed(2)}</strong>
          </p>

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

function PresaleIndicator({
  presale,
  presaleEnded
}: {
  presale: PresaleStatusResponse | null;
  presaleEnded: boolean;
}) {
  // Date-based end takes priority: once the window closes there's no presale to
  // count, regardless of the cupo the status endpoint reports.
  if (presaleEnded) {
    return (
      <p className="tk-stock tk-stock--soldout">
        preventa finalizada — entrada general al precio del día ★
      </p>
    );
  }
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

function Confirmation({
  data,
  yappyCdnUrl,
  onReset
}: {
  data: CreateOrderResponse;
  yappyCdnUrl: string | null;
  onReset: () => void;
}) {
  const isYappy = data.payment.method === 'yappy';
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

          {isYappy ? (
            <YappyCheckout data={data} cdnUrl={yappyCdnUrl} onReset={onReset} />
          ) : (
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
          )}

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

/**
 * Yappy checkout block: renders the brand button and polls the order status
 * until the server-side IPN confirms the payment. eventSuccess only switches
 * the copy to "esperando confirmación" — `paid` is whatever the backend says,
 * so a refresh mid-payment (which kills the Yappy modal) loses nothing.
 */
function YappyCheckout({
  data,
  cdnUrl,
  onReset
}: {
  data: CreateOrderResponse;
  cdnUrl: string | null;
  onReset: () => void;
}) {
  const [phase, setPhase] = useState<'pay' | 'waiting' | 'paid' | 'expired'>('pay');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (phase === 'paid' || phase === 'expired') return;
    const poll = async () => {
      try {
        const status = await getOrderStatus(data.orderId);
        if (status.status === 'paid') {
          setPhase('paid');
        } else if (status.status === 'cancelled') {
          setPhase('expired');
        } else if (
          status.reservationExpiresAt &&
          new Date(status.reservationExpiresAt) <= new Date()
        ) {
          setPhase('expired');
        }
      } catch {
        // transient network error — next tick retries
      }
    };
    poll();
    const timer = setInterval(poll, 4000);
    return () => clearInterval(timer);
  }, [phase, data.orderId]);

  if (phase === 'paid') {
    return (
      <div className="tk-alert tk-alert--success" style={{ textAlign: 'left' }}>
        <strong>¡Pago confirmado! ⚡</strong>
        <p style={{ margin: 0 }}>
          Tu {data.quantity === 1 ? 'entrada va' : 'entradas van'} en camino a tu correo con el
          código QR. Revisa también la carpeta de spam.
        </p>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div className="tk-alert tk-alert--error" role="alert" style={{ textAlign: 'left' }}>
        <strong>Tu reserva expiró</strong>
        <p style={{ margin: 0 }}>
          El pago no se confirmó a tiempo y el cupo fue liberado. Crea una nueva orden para volver a
          intentarlo.
        </p>
        <p style={{ margin: '8px 0 0' }}>
          <button className="tk-btn-secondary" onClick={onReset}>
            Crear nueva orden
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="tk-alert tk-alert--success" style={{ textAlign: 'left' }}>
      <strong>Siguiente paso — Paga con Yappy</strong>
      <p style={{ margin: '0 0 8px' }}>{data.payment.note}</p>
      {cdnUrl ? (
        <YappyButton
          orderId={data.orderId}
          cdnUrl={cdnUrl}
          onPaymentSent={() => {
            setMessage('');
            setPhase('waiting');
          }}
          onError={(msg) => setMessage(msg)}
        />
      ) : (
        <p style={{ margin: 0 }}>Cargando el botón de Yappy…</p>
      )}
      {phase === 'waiting' && (
        <p style={{ margin: '8px 0 0' }}>
          Esperando la confirmación de Yappy… esta página se actualiza sola al confirmarse el pago.
        </p>
      )}
      {message && (
        <p style={{ margin: '8px 0 0' }} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
