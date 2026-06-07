import { useCallback, useEffect, useState } from 'react';
import {
  cleanupExpired,
  fetchAdminOrders,
  markOrderPaid,
  toggleStage2,
  type AdminOrder,
  type AdminStats
} from '../shared/api';

const STORAGE_KEY = 'wwwy3_admin_pw';

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
  return <Dashboard password={password} onLogout={() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setPassword('');
    setAuthed(false);
  }} />;
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
      // A successful listing call doubles as a password check.
      await fetchAdminOrders(password);
      onSuccess();
    } catch {
      setError('Contraseña incorrecta.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400 }}>
      <form className="card" onSubmit={submit}>
        <h1 style={{ marginTop: 0 }}>Panel de admin</h1>
        <label htmlFor="pw">Contraseña</label>
        <input
          id="pw"
          type="password"
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

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminOrders(password, { q, status: statusFilter });
      setOrders(data.orders);
      setStats(data.stats);
    } catch {
      setMessage('Error cargando órdenes.');
    } finally {
      setLoading(false);
    }
  }, [password, q, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMarkPaid(order: AdminOrder) {
    const ref = window.prompt(
      `Marcar como PAGADA la orden de ${order.buyer_name} (${order.quantity} x ${order.tier}).\nReferencia de pago (opcional):`,
      ''
    );
    if (ref === null) return; // cancelled
    setBusyId(order.id);
    setMessage('');
    try {
      const result = await markOrderPaid(password, order.id, ref || undefined);
      setMessage(
        result.emailed
          ? `✓ Pagada. ${result.ticketCount} entrada(s) emitidas y correo enviado.`
          : `✓ Pagada. ${result.ticketCount} entrada(s) (correo ya se había enviado).`
      );
      await load();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      setMessage(code === 'order_cancelled' ? 'La orden está cancelada.' : 'Error al marcar pagada.');
    } finally {
      setBusyId('');
    }
  }

  async function handleStage2(active: boolean) {
    if (!window.confirm(active ? '¿Activar Etapa 2 (75 cupos extra)?' : '¿Desactivar Etapa 2?')) return;
    try {
      await toggleStage2(password, active);
      await load();
    } catch {
      setMessage('Error al cambiar la Etapa 2.');
    }
  }

  async function handleCleanup() {
    if (!window.confirm('¿Cancelar todas las órdenes pendientes vencidas y liberar su cupo?')) return;
    try {
      const { cancelled } = await cleanupExpired(password);
      setMessage(`${cancelled} orden(es) vencida(s) cancelada(s).`);
      await load();
    } catch {
      setMessage('Error en la limpieza.');
    }
  }

  return (
    <div className="container" style={{ maxWidth: 980 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Panel WWWY3</h1>
        <button className="secondary" onClick={onLogout}>
          Salir
        </button>
      </header>

      {stats && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Preventa</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat__value">{stats.presale.paid}</div>
              <div className="stat__label">Pagadas</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.presale.pending}</div>
              <div className="stat__label">Pendientes</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.presale.available}</div>
              <div className="stat__label">Disponibles</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.presale.capacity}</div>
              <div className="stat__label">Capacidad</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>
              Etapa 2:{' '}
              <strong>{stats.presale.stage2Active ? 'ACTIVA' : 'inactiva'}</strong>
            </span>
            {stats.presale.stage2Active ? (
              <button className="secondary" onClick={() => handleStage2(false)}>
                Desactivar Etapa 2
              </button>
            ) : (
              <button onClick={() => handleStage2(true)}>Activar Etapa 2 (+75)</button>
            )}
            <button className="secondary" onClick={handleCleanup}>
              Limpiar pendientes vencidas
            </button>
          </div>

          <hr style={{ borderColor: 'var(--border)', margin: '16px 0' }} />
          <div className="stat-grid">
            <div className="stat">
              <div className="stat__value">{stats.generalPaid}</div>
              <div className="stat__label">General pagadas</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.totalTicketsPaid}</div>
              <div className="stat__label">Entradas totales</div>
            </div>
            <div className="stat">
              <div className="stat__value">${(stats.revenueCents / 100).toFixed(0)}</div>
              <div className="stat__label">Ingresos</div>
            </div>
          </div>
        </div>
      )}

      {message && <div className="alert alert--success">{message}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar por nombre o correo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1, marginBottom: 0, minWidth: 200 }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: 160, marginBottom: 0 }}
          >
            <option value="">Todos</option>
            <option value="pending">Pendientes</option>
            <option value="paid">Pagadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
          <button className="secondary" onClick={load}>
            Refrescar
          </button>
        </div>

        {loading ? (
          <p className="muted">Cargando…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Comprador</th>
                  <th>Tipo</th>
                  <th>Cant.</th>
                  <th>Total</th>
                  <th>Pago</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {o.buyer_name}
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {o.buyer_email}
                      </span>
                    </td>
                    <td>{o.tier}</td>
                    <td>{o.quantity}</td>
                    <td>${(o.total_cents / 100).toFixed(2)}</td>
                    <td>{o.payment_method}</td>
                    <td>
                      <span className={`badge badge--${o.status}`}>{o.status}</span>
                    </td>
                    <td>
                      {o.status === 'pending' && (
                        <button onClick={() => handleMarkPaid(o)} disabled={busyId === o.id}>
                          {busyId === o.id ? '…' : 'Marcar pagada'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No hay órdenes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
