import { useState } from 'react';
import {
  fetchSupportOrder,
  fetchSupportOrders,
  resendTicketEmail,
  type AdminOrder,
  type SupportTicket
} from '../shared/api';
import { TIER_LABELS } from '../shared/config';

// Customer-support surface: read-only order/ticket lookup + resend QR email.
// It deliberately exposes none of the admin mutations (mark paid, cancel,
// revoke, courtesy, stage 2) nor the sales/revenue stats — the server enforces
// this too (isSupport gate in api/admin.ts). Auth uses SUPPORT_PASSWORD (or the
// admin password) and is kept only in sessionStorage.

const STORAGE_KEY = 'wwwy3_support_pw';

const METHOD_LABELS: Record<string, string> = {
  yappy: 'Yappy',
  cuantoapp: 'Tarjeta',
  cash: 'Efectivo',
  courtesy: 'Cortesía'
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada'
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  valid: 'Válida',
  used: 'Usada',
  void: 'Anulada'
};

const RESEND_ERRORS: Record<string, string> = {
  order_not_found: 'No se encontró la orden.',
  order_not_paid: 'La orden no está pagada; no hay entradas que reenviar.',
  no_valid_tickets: 'La orden no tiene entradas válidas.'
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function App() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(STORAGE_KEY) ?? '');
  const [authed, setAuthed] = useState(false);

  if (!authed) {
    return (
      <Gate
        password={password}
        setPassword={setPassword}
        onSuccess={() => {
          sessionStorage.setItem(STORAGE_KEY, password);
          setAuthed(true);
        }}
      />
    );
  }
  return (
    <Support
      password={password}
      onLogout={() => {
        sessionStorage.removeItem(STORAGE_KEY);
        setPassword('');
        setAuthed(false);
      }}
    />
  );
}

function Gate({
  password,
  setPassword,
  onSuccess
}: {
  password: string;
  setPassword: (v: string) => void;
  onSuccess: () => void;
}) {
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError('');
    try {
      // An empty search returns 200 (no rows) for an authenticated support
      // user, so it doubles as a password check.
      await fetchSupportOrders(password, '');
      onSuccess();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setError('Contraseña incorrecta.');
      else setError('Error de conexión.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400 }}>
      <form className="card" onSubmit={submit}>
        <h1 style={{ marginTop: 0 }}>Soporte</h1>
        <label htmlFor="username">Usuario</label>
        <input id="username" name="username" type="text" value="soporte" autoComplete="username" readOnly />
        <label htmlFor="pw">Contraseña</label>
        <input
          id="pw"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <div className="alert alert--error">{error}</div>}
        <button type="submit" disabled={checking} style={{ width: '100%' }}>
          {checking ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

function Support({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError('');
    try {
      const { orders: found } = await fetchSupportOrders(password, q);
      setOrders(found);
    } catch {
      setError('Error al buscar. Verificá la conexión.');
      setOrders(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Soporte WWWY3</h1>
        <button className="secondary" onClick={onLogout}>
          Salir
        </button>
      </header>

      <form onSubmit={search} className="card" style={{ marginBottom: 20 }}>
        <label htmlFor="q">Buscar cliente u orden</label>
        <input
          id="q"
          type="search"
          placeholder="Email, teléfono, nombre o # de orden"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          style={{ marginBottom: 12 }}
        />
        <button type="submit" disabled={loading || !query.trim()} style={{ width: '100%' }}>
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
        <p className="muted" style={{ fontSize: 13, margin: '12px 0 0' }}>
          Solo lectura: podés consultar órdenes y entradas, y reenviar el correo con el QR.
        </p>
      </form>

      {error && <div className="alert alert--error">{error}</div>}

      {orders !== null && orders.length === 0 && !error && (
        <p className="muted">No se encontraron órdenes para esa búsqueda.</p>
      )}

      {orders?.map((order) => (
        <OrderCard key={order.id} order={order} password={password} />
      ))}
    </div>
  );
}

function OrderCard({ order, password }: { order: AdminOrder; password: string }) {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [resending, setResending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function toggleTickets() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (tickets === null) {
      setLoadingTickets(true);
      try {
        const detail = await fetchSupportOrder(password, order.id);
        setTickets(detail.tickets);
      } catch {
        setFeedback({ kind: 'error', text: 'No se pudieron cargar las entradas.' });
      } finally {
        setLoadingTickets(false);
      }
    }
  }

  async function resend() {
    if (!window.confirm(`¿Reenviar el correo con el QR a ${order.buyer_email}?`)) return;
    setResending(true);
    setFeedback(null);
    try {
      const { ticketCount } = await resendTicketEmail(password, order.id);
      setFeedback({
        kind: 'success',
        text: `Correo reenviado a ${order.buyer_email} (${ticketCount} entrada${ticketCount === 1 ? '' : 's'}).`
      });
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      setFeedback({ kind: 'error', text: (code && RESEND_ERRORS[code]) || 'No se pudo reenviar el correo.' });
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
        <div>
          <strong>{order.buyer_name}</strong>
          <div className="muted" style={{ fontSize: 14 }}>{order.buyer_email}</div>
          {order.buyer_phone && <div className="muted" style={{ fontSize: 14 }}>{order.buyer_phone}</div>}
        </div>
        <span className={`badge badge--${order.status}`}>
          {ORDER_STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      <div className="stat-grid" style={{ margin: '16px 0' }}>
        <div className="stat">
          <div className="stat__value" style={{ fontSize: 20 }}>{TIER_LABELS[order.tier] ?? order.tier}</div>
          <div className="stat__label">Tipo</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{ fontSize: 20 }}>{order.quantity}</div>
          <div className="stat__label">Entradas</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{ fontSize: 20 }}>{money(order.total_cents)}</div>
          <div className="stat__label">Total</div>
        </div>
        <div className="stat">
          <div className="stat__value" style={{ fontSize: 20 }}>{METHOD_LABELS[order.payment_method] ?? order.payment_method}</div>
          <div className="stat__label">Pago</div>
        </div>
      </div>

      <table style={{ marginBottom: 12 }}>
        <tbody>
          <tr>
            <th>Creada</th>
            <td>{fmtDateTime(order.created_at)}</td>
          </tr>
          <tr>
            <th>Correo enviado</th>
            <td>{order.emailed_at ? fmtDateTime(order.emailed_at) : 'No enviado'}</td>
          </tr>
          <tr>
            <th># de orden</th>
            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{order.id}</td>
          </tr>
        </tbody>
      </table>

      {feedback && (
        <div className={`alert alert--${feedback.kind}`}>{feedback.text}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="secondary small" onClick={toggleTickets}>
          {expanded ? 'Ocultar entradas' : 'Ver entradas'}
        </button>
        {order.status === 'paid' && (
          <button type="button" className="small" onClick={resend} disabled={resending}>
            {resending ? 'Reenviando…' : 'Reenviar correo'}
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {loadingTickets && <p className="muted">Cargando entradas…</p>}
          {!loadingTickets && tickets !== null && tickets.length === 0 && (
            <p className="muted">Esta orden todavía no tiene entradas emitidas.</p>
          )}
          {!loadingTickets && tickets !== null && tickets.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Entrada</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Usada</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.id.slice(0, 8)}</td>
                    <td>{TIER_LABELS[t.tier] ?? t.tier}</td>
                    <td>
                      <span className={`badge badge--${t.status}`}>
                        {TICKET_STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </td>
                    <td>{t.used_at ? fmtDateTime(t.used_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
