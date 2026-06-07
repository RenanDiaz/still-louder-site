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
    <div className="container">
      <header style={{ marginBottom: 24 }}>
        <p className="muted" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {EVENT.band}
        </p>
        <h1 style={{ margin: '4px 0' }}>{EVENT.name}</h1>
        <p className="muted">
          Una noche de covers de las bandas que nos inspiraron · {EVENT.venue} · 1 de agosto
        </p>
      </header>

      <div className="card" style={{ marginBottom: 20 }}>
        <Countdown />
        <PresaleIndicator presale={presale} />
      </div>

      <form className="card" onSubmit={handleSubmit}>
        <h2 style={{ marginTop: 0 }}>Compra tus entradas</h2>

        <label htmlFor="tier">Tipo de entrada</label>
        <select
          id="tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as TierKey)}
        >
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
        <p className="muted" style={{ marginTop: -10, fontSize: 13 }}>
          Aquí enviaremos tu entrada con el código QR.
        </p>

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

        {error && <div className="alert alert--error">{error}</div>}

        <button type="submit" disabled={submitting} style={{ width: '100%' }}>
          {submitting ? 'Procesando…' : `Continuar — $${(total / 100).toFixed(2)}`}
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
          Compra directamente con la banda. Canales oficiales: @stilllouder. No vendemos por
          intermediarios.
        </p>
      </form>
    </div>
  );
}

function PresaleIndicator({ presale }: { presale: PresaleStatusResponse | null }) {
  if (!presale) return null;
  if (presale.soldOut) {
    return (
      <p style={{ marginBottom: 0 }}>
        <span className="badge badge--cancelled">Preventa agotada</span> — entrada general disponible
        el día del evento.
      </p>
    );
  }
  return (
    <p style={{ marginBottom: 0 }}>
      <span className="badge badge--paid">Preventa abierta</span> Quedan{' '}
      <strong>{presale.available}</strong> entradas de preventa.
    </p>
  );
}

function Confirmation({ data, onReset }: { data: CreateOrderResponse; onReset: () => void }) {
  return (
    <div className="container">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>¡Orden creada! 🎟️</h1>
        <p>
          Reservamos {data.quantity} {data.quantity === 1 ? 'entrada' : 'entradas'} por un total de{' '}
          <strong>{data.payment.amount}</strong>.
        </p>

        <div className="alert alert--success">
          <strong>Siguiente paso — {data.payment.method === 'cash' ? 'Efectivo' : 'Pago'}:</strong>
          <p style={{ margin: '8px 0 0' }}>{data.payment.note}</p>
          {data.payment.link && (
            <p style={{ marginBottom: 0 }}>
              <a href={data.payment.link} target="_blank" rel="noopener noreferrer">
                Ir a pagar →
              </a>
            </p>
          )}
        </div>

        <p className="muted">
          Tu entrada con el código QR llegará por correo en cuanto confirmemos el pago. Guarda tu
          número de orden: <code>{data.orderId}</code>
        </p>

        <button className="secondary" onClick={onReset}>
          Comprar otra entrada
        </button>
      </div>
    </div>
  );
}
