import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelOrder,
  cleanupExpired,
  createCourtesyOrder,
  ensureWalletClass,
  fetchAdminOrders,
  fetchAdminTickets,
  fetchRefundReceipt,
  markOrderPaid,
  refundOrder,
  resendTicketEmail,
  revokeTicket,
  toggleStage2,
  unrevokeTicket,
  type AdminOrder,
  type AdminStats,
  type AdminTicket,
  type AdminTicketsResponse
} from '../shared/api';
import { TIER_LABELS } from '../shared/config';

const STORAGE_KEY = 'wwwy3_admin_pw';

const METHOD_LABELS: Record<string, string> = {
  yappy: 'Yappy',
  cuantoapp: 'Tarjeta',
  cash: 'Efectivo',
  courtesy: 'Cortesía'
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  valid: 'Válida',
  used: 'Usada',
  void: 'Anulada'
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

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? '' : String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\n');
  // BOM so Excel opens the UTF-8 accents correctly.
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
        <h1 style={{ marginTop: 0 }}>Panel de admin</h1>
        <label htmlFor="username">Usuario</label>
        <input
          id="username"
          name="username"
          type="text"
          value="admin"
          autoComplete="username"
          readOnly
        />
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

type TabKey = 'resumen' | 'ordenes' | 'entradas' | 'checkin';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'ordenes', label: 'Órdenes' },
  { key: 'entradas', label: 'Entradas' },
  { key: 'checkin', label: 'Check-in' }
];

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [tab, setTab] = useState<TabKey>('resumen');

  return (
    <div className="container" style={{ maxWidth: 980 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Panel WWWY3</h1>
        <button className="secondary" onClick={onLogout}>
          Salir
        </button>
      </header>

      <nav className="tabs" aria-label="Secciones del panel">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab ${tab === t.key ? 'tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'resumen' && <ResumenTab password={password} />}
      {tab === 'ordenes' && <OrdenesTab password={password} />}
      {tab === 'entradas' && <EntradasTab password={password} />}
      {tab === 'checkin' && <CheckinTab password={password} />}
    </div>
  );
}

// --- Resumen (reportes) --------------------------------------------------------

function ResumenTab({ password }: { password: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [ticketStats, setTicketStats] = useState<AdminTicketsResponse['stats'] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Cuántas entradas extra liberar al activar la Etapa 2. Precargado con el
  // valor guardado mientras la etapa está inactiva (oculto cuando ya está activa).
  const [stage2CapInput, setStage2CapInput] = useState('25');

  const load = useCallback(async () => {
    setError('');
    try {
      const [ordersData, ticketsData] = await Promise.all([
        fetchAdminOrders(password),
        fetchAdminTickets(password)
      ]);
      setStats(ordersData.stats);
      setTicketStats(ticketsData.stats);
    } catch {
      setError('Error cargando el resumen.');
    }
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  // Mantener el input en sync con el cupo guardado mientras la Etapa 2 esté
  // inactiva; no pisar lo que el usuario escriba una vez activa.
  useEffect(() => {
    if (stats && !stats.presale.stage2Active) {
      setStage2CapInput(String(stats.presale.stage2Cap));
    }
  }, [stats]);

  async function handleStage2(active: boolean) {
    const cap = active ? Number(stage2CapInput) : undefined;
    if (active && (!Number.isInteger(cap) || (cap as number) < 0)) {
      setError('Ingresa una cantidad válida de entradas para la Etapa 2.');
      return;
    }
    if (!window.confirm(active ? `¿Activar Etapa 2 (${cap} cupos extra)?` : '¿Desactivar Etapa 2?')) return;
    try {
      await toggleStage2(password, active, cap);
      await load();
    } catch {
      setError('Error al cambiar la Etapa 2.');
    }
  }

  async function handleCleanup() {
    if (!window.confirm('¿Cancelar todas las órdenes pendientes vencidas y liberar su cupo?')) return;
    try {
      const { cancelled } = await cleanupExpired(password);
      setMessage(`${cancelled} orden(es) vencida(s) cancelada(s).`);
      await load();
    } catch {
      setError('Error en la limpieza.');
    }
  }

  async function handleWalletClass() {
    if (!window.confirm('¿Crear/verificar la clase de Google Wallet del evento? Es seguro repetirlo.')) return;
    setError('');
    try {
      const { classId, created } = await ensureWalletClass(password);
      setMessage(created ? `✓ Clase de Google Wallet creada (${classId}).` : `✓ La clase de Google Wallet ya existía (${classId}).`);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      setMessage('');
      setError(
        code === 'google_wallet_not_configured'
          ? 'Google Wallet no está configurado (faltan las variables GOOGLE_WALLET_*).'
          : 'Error al crear la clase de Google Wallet.'
      );
    }
  }

  if (!stats || !ticketStats) {
    return error ? <div className="alert alert--error">{error}</div> : <p className="muted">Cargando…</p>;
  }

  const tierRows = Object.entries(ticketStats.byTier);

  return (
    <>
      {message && <div className="alert alert--success">{message}</div>}
      {error && <div className="alert alert--error">{error}</div>}

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
            <div className="stat__value">{stats.presale.courtesy}</div>
            <div className="stat__label">Cortesías</div>
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
            Etapa 2: <strong>{stats.presale.stage2Active ? 'ACTIVA' : 'inactiva'}</strong>
            {stats.presale.stage2Active ? ` (+${stats.presale.stage2Cap} cupos)` : ''}
          </span>
          {stats.presale.stage2Active ? (
            <button className="secondary" onClick={() => handleStage2(false)}>
              Desactivar Etapa 2
            </button>
          ) : (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Cupos extra:
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={stage2CapInput}
                  onChange={(e) => setStage2CapInput(e.target.value)}
                  style={{ width: 80 }}
                />
              </label>
              <button onClick={() => handleStage2(true)}>Activar Etapa 2</button>
            </>
          )}
          <button className="secondary" onClick={handleCleanup}>
            Limpiar pendientes vencidas
          </button>
          <button className="secondary" onClick={handleWalletClass}>
            Clase de Google Wallet
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Ventas</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{stats.generalPaid}</div>
            <div className="stat__label">General pagadas</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.courtesyTickets}</div>
            <div className="stat__label">Cortesías</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.totalTicketsPaid}</div>
            <div className="stat__label">Entradas totales</div>
          </div>
          <div className="stat">
            <div className="stat__value">${(stats.revenueCents / 100).toFixed(0)}</div>
            <div className="stat__label">Ingresos netos</div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Cobrado al comprador: <strong>{money(stats.grossCents)}</strong> · de eso,{' '}
          <strong>{money(stats.feesCents)}</strong> son recargos por servicio que cubren las
          comisiones de pago. El neto ({money(stats.revenueCents)}) es lo que recibe la banda.
        </p>
        {stats.refundedOrders > 0 && (
          <p className="muted" style={{ marginTop: 4 }}>
            Reembolsadas: <strong>{stats.refundedOrders}</strong> orden(es) ·{' '}
            <strong>{stats.refundedTickets}</strong> entrada(s) anuladas ·{' '}
            <strong>{money(stats.refundedGrossCents)}</strong> devueltos (no incluidos en los
            ingresos de arriba).
          </p>
        )}
        <h3 style={{ marginBottom: 8 }}>Ingresos netos por método de pago</h3>
        <table style={{ maxWidth: 360 }}>
          <tbody>
            {Object.entries(stats.revenueByMethod).map(([method, cents]) => (
              <tr key={method}>
                <td>{METHOD_LABELS[method] ?? method}</td>
                <td style={{ textAlign: 'right' }}>{money(cents)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td style={{ textAlign: 'right' }}>
                <strong>{money(stats.revenueCents)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Entradas emitidas</h2>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{ticketStats.total}</div>
            <div className="stat__label">Emitidas</div>
          </div>
          <div className="stat">
            <div className="stat__value">{ticketStats.used}</div>
            <div className="stat__label">Usadas</div>
          </div>
          <div className="stat">
            <div className="stat__value">{ticketStats.valid}</div>
            <div className="stat__label">Sin usar</div>
          </div>
          <div className="stat">
            <div className="stat__value">{ticketStats.void}</div>
            <div className="stat__label">Anuladas</div>
          </div>
        </div>
        {tierRows.length > 0 && (
          <table style={{ maxWidth: 480 }}>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Emitidas</th>
                <th>Usadas</th>
                <th>Sin usar</th>
                <th>Anuladas</th>
              </tr>
            </thead>
            <tbody>
              {tierRows.map(([tier, counts]) => (
                <tr key={tier}>
                  <td>{TIER_LABELS[tier] ?? tier}</td>
                  <td>{counts.total}</td>
                  <td>{counts.used}</td>
                  <td>{counts.valid}</td>
                  <td>{counts.void}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 16 }}>
          <button className="secondary" onClick={load}>
            Refrescar
          </button>
        </div>
      </div>
    </>
  );
}

// --- Órdenes ---------------------------------------------------------------------

function OrdenesTab({ password }: { password: string }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showCourtesy, setShowCourtesy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminOrders(password, { q, status: statusFilter });
      setOrders(data.orders);
    } catch {
      setError('Error cargando órdenes.');
    } finally {
      setLoading(false);
    }
  }, [password, q, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function notify(ok: string) {
    setError('');
    setMessage(ok);
  }

  function notifyError(msg: string) {
    setMessage('');
    setError(msg);
  }

  async function handleMarkPaid(order: AdminOrder) {
    const ref = window.prompt(
      `Marcar como PAGADA la orden de ${order.buyer_name} (${order.quantity} x ${order.tier}).\nReferencia de pago (opcional):`,
      ''
    );
    if (ref === null) return; // cancelled
    setBusyId(order.id);
    try {
      const result = await markOrderPaid(password, order.id, ref || undefined);
      notify(
        result.emailed
          ? `✓ Pagada. ${result.ticketCount} entrada(s) emitidas y correo enviado.`
          : `✓ Pagada. ${result.ticketCount} entrada(s) (correo ya se había enviado).`
      );
      await load();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      notifyError(code === 'order_cancelled' ? 'La orden está cancelada.' : 'Error al marcar pagada.');
    } finally {
      setBusyId('');
    }
  }

  async function handleCancel(order: AdminOrder) {
    if (
      !window.confirm(
        `¿Cancelar la orden pendiente de ${order.buyer_name} (${order.quantity} x ${order.tier})? Su cupo se libera al instante.`
      )
    ) {
      return;
    }
    setBusyId(order.id);
    try {
      await cancelOrder(password, order.id);
      notify(`✓ Orden de ${order.buyer_name} cancelada.`);
      await load();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      notifyError(code === 'order_paid' ? 'La orden ya está pagada; anula sus entradas en su lugar.' : 'Error al cancelar.');
    } finally {
      setBusyId('');
    }
  }

  async function handleResend(order: AdminOrder) {
    if (!window.confirm(`¿Reenviar el correo con los QR a ${order.buyer_email}?`)) return;
    setBusyId(order.id);
    try {
      const result = await resendTicketEmail(password, order.id);
      notify(`✓ Correo reenviado a ${order.buyer_email} con ${result.ticketCount} entrada(s).`);
      await load();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      notifyError(
        code === 'no_valid_tickets'
          ? 'Todas las entradas de esa orden están anuladas; no hay nada que enviar.'
          : 'Error al reenviar el correo.'
      );
    } finally {
      setBusyId('');
    }
  }

  // Marks a paid order refunded and voids its tickets. For Yappy it first tries
  // the API reversal (only works while the charge is still "en tránsito"); if
  // that fails it offers to record the refund manually so the admin can settle
  // the money through Yappy's portal. Non-Yappy orders go straight to manual.
  async function markRefundedManually(order: AdminOrder): Promise<void> {
    const ref = window.prompt('Referencia del reembolso (opcional):', '') ?? '';
    const result = await refundOrder(password, order.id, { manual: true, refund_ref: ref || undefined });
    notify(`✓ Orden de ${order.buyer_name} marcada como reembolsada. ${result.voidedCount} entrada(s) anuladas.`);
    await load();
  }

  async function handleRefund(order: AdminOrder) {
    const isYappy = order.payment_method === 'yappy';
    const confirmMsg = isYappy
      ? `¿Reembolsar la orden de ${order.buyer_name} (${money(order.total_cents)})?\n\nSe intentará la reversa automática por la API de Yappy (solo funciona mientras la transacción siga "en tránsito") y se ANULARÁN sus ${order.quantity} entrada(s).`
      : `¿Marcar como reembolsada la orden de ${order.buyer_name} (${money(order.total_cents)}) y ANULAR sus ${order.quantity} entrada(s)?\n\nLa devolución del dinero se gestiona por fuera (este método no tiene reversa por API).`;
    if (!window.confirm(confirmMsg)) return;

    setBusyId(order.id);
    try {
      if (!isYappy) {
        await markRefundedManually(order);
        return;
      }
      const result = await refundOrder(password, order.id, {});
      notify(`✓ Reembolsada vía Yappy. ${result.voidedCount} entrada(s) anuladas.`);
      await load();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (isYappy && (code === 'yappy_failed' || code === 'yappy_not_configured' || code === 'no_transaction_id')) {
        const reason =
          code === 'yappy_failed'
            ? 'Yappy rechazó la reversa (probablemente la transacción ya se acreditó / está fuera de la ventana "en tránsito").'
            : code === 'yappy_not_configured'
              ? 'La API transaccional de Yappy no está configurada.'
              : 'La orden no tiene un transactionId de Yappy para reversar.';
        if (
          window.confirm(
            `${reason}\n\n¿Marcar la orden como reembolsada de todos modos? Tendrás que hacer la devolución del dinero manualmente por el portal de Yappy.`
          )
        ) {
          try {
            await markRefundedManually(order);
          } catch {
            notifyError('Error al marcar reembolsada.');
          }
        }
      } else {
        notifyError(code === 'order_not_paid' ? 'La orden no está pagada.' : 'Error al reembolsar.');
      }
    } finally {
      setBusyId('');
    }
  }

  // Opens the printable refund receipt for a refunded order in a new tab. Works
  // for refunds from any date — the receipt is rendered from the stored order.
  // The blank tab is opened synchronously (before the await) so popup blockers
  // don't swallow it; the fetched HTML is then written into it.
  //
  // The receipt's "Imprimir / Guardar PDF" button can't use an inline onclick:
  // the about:blank tab inherits this admin page's CSP (script-src 'self', no
  // 'unsafe-inline'), which blocks inline event handlers. Since the tab is
  // same-origin with the opener, we attach the print handler from here instead.
  async function handleReceipt(order: AdminOrder) {
    const win = window.open('', '_blank');
    setBusyId(order.id);
    try {
      const html = await fetchRefundReceipt(password, order.id);
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.document.getElementById('sl-print')?.addEventListener('click', () => win.print());
        notify(`✓ Comprobante de reembolso de ${order.buyer_name} generado.`);
      } else {
        notifyError('Permite las ventanas emergentes para ver el comprobante.');
      }
    } catch (err) {
      if (win) win.close();
      const code = (err as Error & { code?: string }).code;
      notifyError(
        code === 'order_not_refunded'
          ? 'Solo las órdenes reembolsadas tienen comprobante.'
          : 'Error al generar el comprobante.'
      );
    } finally {
      setBusyId('');
    }
  }

  function exportCsv() {
    const rows: (string | number | null)[][] = [
      ['Comprador', 'Correo', 'Teléfono', 'Tipo', 'Cantidad', 'Neto', 'Cargo por servicio', 'Total cobrado', 'Pago', 'Referencia', 'Estado', 'Creada', 'Pagada'],
      ...orders.map((o) => [
        o.buyer_name,
        o.buyer_email,
        o.buyer_phone,
        TIER_LABELS[o.tier] ?? o.tier,
        o.quantity,
        (o.net_cents / 100).toFixed(2),
        (o.fee_cents / 100).toFixed(2),
        (o.total_cents / 100).toFixed(2),
        METHOD_LABELS[o.payment_method] ?? o.payment_method,
        o.payment_ref,
        o.status,
        o.created_at,
        o.paid_at
      ])
    ];
    downloadCsv(`ordenes-wwwy3-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  return (
    <>
      {message && <div className="alert alert--success">{message}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Cortesías</h2>
          <button className="secondary" onClick={() => setShowCourtesy((v) => !v)}>
            {showCourtesy ? 'Ocultar' : 'Nueva cortesía'}
          </button>
        </div>
        {showCourtesy && (
          <CourtesyForm
            password={password}
            onDone={(msg) => {
              notify(msg);
              setShowCourtesy(false);
              load();
            }}
            onError={notifyError}
          />
        )}
      </div>

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
            <option value="refunded">Reembolsadas</option>
          </select>
          <button className="secondary" onClick={load}>
            Refrescar
          </button>
          <button className="secondary" onClick={exportCsv} disabled={orders.length === 0}>
            Exportar CSV
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
                    <td>{TIER_LABELS[o.tier] ?? o.tier}</td>
                    <td>{o.quantity}</td>
                    <td>{money(o.total_cents)}</td>
                    <td>{METHOD_LABELS[o.payment_method] ?? o.payment_method}</td>
                    <td>
                      <span className={`badge badge--${o.status}`}>{o.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {o.status === 'pending' && (
                          <>
                            <button
                              className="small"
                              onClick={() => handleMarkPaid(o)}
                              disabled={busyId === o.id}
                            >
                              {busyId === o.id ? '…' : 'Marcar pagada'}
                            </button>
                            <button
                              className="secondary small"
                              onClick={() => handleCancel(o)}
                              disabled={busyId === o.id}
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                        {o.status === 'paid' && (
                          <>
                            <button
                              className="secondary small"
                              onClick={() => handleResend(o)}
                              disabled={busyId === o.id}
                            >
                              {busyId === o.id ? '…' : 'Reenviar correo'}
                            </button>
                            <button
                              className="secondary small"
                              onClick={() => handleRefund(o)}
                              disabled={busyId === o.id}
                            >
                              Reembolsar
                            </button>
                          </>
                        )}
                        {o.status === 'refunded' && (
                          <button
                            className="secondary small"
                            onClick={() => handleReceipt(o)}
                            disabled={busyId === o.id}
                          >
                            {busyId === o.id ? '…' : 'Comprobante'}
                          </button>
                        )}
                      </div>
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
    </>
  );
}

function CourtesyForm({
  password,
  onDone,
  onError
}: {
  password: string;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !window.confirm(
        `¿Generar ${quantity} entrada(s) de cortesía para ${name} (${email})${sendEmail ? ' y enviar el correo' : ' sin enviar correo'}?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await createCourtesyOrder(password, {
        buyer_name: name,
        buyer_email: email,
        quantity,
        note: note || undefined,
        send_email: sendEmail
      });
      onDone(
        result.emailed
          ? `✓ ${result.ticketCount} cortesía(s) emitida(s) y correo enviado a ${email}.`
          : `✓ ${result.ticketCount} cortesía(s) emitida(s) sin correo (puedes reenviarlo luego).`
      );
    } catch {
      onError('Error al generar la cortesía. Revisa los datos.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div>
          <label htmlFor="c-name">Nombre</label>
          <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </div>
        <div>
          <label htmlFor="c-email">Correo</label>
          <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="c-qty">Cantidad</label>
          <input
            id="c-qty"
            type="number"
            min={1}
            max={10}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            required
          />
        </div>
        <div>
          <label htmlFor="c-note">Nota (opcional)</label>
          <input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ej. prensa, invitado banda" />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(e) => setSendEmail(e.target.checked)}
          style={{ width: 'auto', marginBottom: 0 }}
        />
        Enviar el correo con los QR al destinatario
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Generando…' : 'Generar cortesía'}
      </button>
    </form>
  );
}

// --- Entradas --------------------------------------------------------------------

function EntradasTab({ password }: { password: string }) {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [stats, setStats] = useState<AdminTicketsResponse['stats'] | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminTickets(password, { q, status: statusFilter, tier: tierFilter });
      setTickets(data.tickets);
      setStats(data.stats);
    } catch {
      setError('Error cargando entradas.');
    } finally {
      setLoading(false);
    }
  }, [password, q, statusFilter, tierFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRevoke(ticket: AdminTicket) {
    if (
      !window.confirm(
        `¿ANULAR la entrada de ${ticket.buyer_name} (${TIER_LABELS[ticket.tier] ?? ticket.tier})? El QR será rechazado en la puerta.`
      )
    ) {
      return;
    }
    setBusyId(ticket.id);
    try {
      await revokeTicket(password, ticket.id);
      setError('');
      setMessage(`✓ Entrada de ${ticket.buyer_name} anulada.`);
      await load();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      setMessage('');
      setError(code === 'ticket_used' ? 'La entrada ya fue usada; no se puede anular.' : 'Error al anular.');
    } finally {
      setBusyId('');
    }
  }

  async function handleUnrevoke(ticket: AdminTicket) {
    if (!window.confirm(`¿Restaurar la entrada anulada de ${ticket.buyer_name}? Volverá a ser válida en la puerta.`)) {
      return;
    }
    setBusyId(ticket.id);
    try {
      await unrevokeTicket(password, ticket.id);
      setError('');
      setMessage(`✓ Entrada de ${ticket.buyer_name} restaurada.`);
      await load();
    } catch {
      setMessage('');
      setError('Error al restaurar la entrada.');
    } finally {
      setBusyId('');
    }
  }

  function exportCsv() {
    const rows: (string | number | null)[][] = [
      ['Entrada', 'Comprador', 'Correo', 'Tipo', 'Estado', 'Usada', 'Estación', 'Emitida'],
      ...tickets.map((t) => [
        t.id,
        t.buyer_name,
        t.buyer_email,
        TIER_LABELS[t.tier] ?? t.tier,
        TICKET_STATUS_LABELS[t.status] ?? t.status,
        t.used_at,
        t.used_by,
        t.created_at
      ])
    ];
    downloadCsv(`entradas-wwwy3-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  return (
    <>
      {message && <div className="alert alert--success">{message}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      {stats && (
        <p className="muted" style={{ marginTop: 0 }}>
          {stats.total} emitidas · {stats.used} usadas · {stats.valid} sin usar · {stats.void} anuladas
        </p>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar por nombre o correo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1, marginBottom: 0, minWidth: 200 }}
          />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            style={{ width: 150, marginBottom: 0 }}
          >
            <option value="">Todos los tipos</option>
            <option value="preventa">Preventa</option>
            <option value="general">General</option>
            <option value="cortesia">Cortesía</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: 150, marginBottom: 0 }}
          >
            <option value="">Todos los estados</option>
            <option value="valid">Válidas</option>
            <option value="used">Usadas</option>
            <option value="void">Anuladas</option>
          </select>
          <button className="secondary" onClick={load}>
            Refrescar
          </button>
          <button className="secondary" onClick={exportCsv} disabled={tickets.length === 0}>
            Exportar CSV
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
                  <th>Estado</th>
                  <th>Usada</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.buyer_name}
                      <br />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {t.buyer_email}
                      </span>
                    </td>
                    <td>{TIER_LABELS[t.tier] ?? t.tier}</td>
                    <td>
                      <span className={`badge badge--${t.status}`}>
                        {TICKET_STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </td>
                    <td>
                      {t.status === 'used' ? (
                        <>
                          {fmtDateTime(t.used_at)}
                          {t.used_by && (
                            <>
                              <br />
                              <span className="muted" style={{ fontSize: 12 }}>
                                {t.used_by}
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {t.status === 'valid' && (
                        <button
                          className="secondary small"
                          onClick={() => handleRevoke(t)}
                          disabled={busyId === t.id}
                        >
                          {busyId === t.id ? '…' : 'Anular'}
                        </button>
                      )}
                      {t.status === 'void' && (
                        <button className="small" onClick={() => handleUnrevoke(t)} disabled={busyId === t.id}>
                          {busyId === t.id ? '…' : 'Restaurar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {tickets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No hay entradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// --- Check-in en vivo --------------------------------------------------------------

const CHECKIN_REFRESH_MS = 10000;

function CheckinTab({ password }: { password: string }) {
  const [data, setData] = useState<AdminTicketsResponse | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchAdminTickets(password);
      setData(result);
      setUpdatedAt(new Date());
      setError('');
    } catch {
      setError('Error actualizando el check-in.');
    }
  }, [password]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, CHECKIN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const recent = useMemo(() => {
    if (!data) return [];
    return data.tickets
      .filter((t) => t.status === 'used' && t.used_at)
      .sort((a, b) => (b.used_at ?? '').localeCompare(a.used_at ?? ''))
      .slice(0, 15);
  }, [data]);

  if (!data) {
    return error ? <div className="alert alert--error">{error}</div> : <p className="muted">Cargando…</p>;
  }

  const { stats } = data;
  // Void tickets can't enter, so the meaningful denominator is total - void.
  const admittable = stats.total - stats.void;
  const pct = admittable > 0 ? Math.round((stats.used / admittable) * 100) : 0;

  return (
    <>
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Asistencia</h2>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 32, fontWeight: 700 }}>
            {stats.used} / {admittable}
          </span>
          <span className="muted">{pct}% adentro</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress__fill" style={{ width: `${pct}%` }} />
        </div>

        <table style={{ maxWidth: 420, marginTop: 16 }}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Adentro</th>
              <th>Por llegar</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stats.byTier).map(([tier, counts]) => (
              <tr key={tier}>
                <td>{TIER_LABELS[tier] ?? tier}</td>
                <td>{counts.used}</td>
                <td>{counts.valid}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Se actualiza cada {CHECKIN_REFRESH_MS / 1000} s{updatedAt ? ` · última: ${updatedAt.toLocaleTimeString('es-PA')}` : ''}.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Últimas validaciones</h2>
        {recent.length === 0 ? (
          <p className="muted">Aún no se ha validado ninguna entrada.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Persona</th>
                <th>Tipo</th>
                <th>Estación</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDateTime(t.used_at)}</td>
                  <td>{t.buyer_name}</td>
                  <td>{TIER_LABELS[t.tier] ?? t.tier}</td>
                  <td>{t.used_by ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
