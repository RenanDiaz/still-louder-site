import { useCallback, useEffect, useState } from 'react';
import {
  downloadReportCsv,
  fetchCheckinReport,
  fetchEventsComparisonReport,
  fetchSalesDailyReport,
  fetchSettlementHtml,
  fetchSettlementReport,
  type AdminEvent,
  type CheckinReport,
  type EventsComparisonReport,
  type SalesDailyReport,
  type SettlementReport
} from '../shared/api';

// =============================================================================
// Pestaña Reportes (docs/features/reportes-admin.md)
// =============================================================================
// Cierre · Ventas por día · Asistencia usan el evento elegido; Comparativo no
// depende del evento. Todo se calcula en el servidor (GET /api/admin/reports/*);
// aquí solo se muestra. Los CSV se generan en el servidor y traen TODAS las
// filas; el cierre además tiene una versión imprimible (Imprimir / PDF).
// =============================================================================

type View = 'cierre' | 'ventas' | 'asistencia' | 'comparativo';

const VIEWS: { key: View; label: string }[] = [
  { key: 'cierre', label: 'Cierre' },
  { key: 'ventas', label: 'Ventas por día' },
  { key: 'asistencia', label: 'Asistencia' },
  { key: 'comparativo', label: 'Comparativo' }
];

const METHOD_LABELS: Record<string, string> = {
  yappy: 'Yappy',
  cuantoapp: 'Tarjeta',
  cash: 'Efectivo',
  courtesy: 'Cortesía',
  gift: 'Regalo'
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  teaser: 'Teaser',
  on_sale: 'En venta',
  archived: 'Archivado'
};

function money(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function pctLabel(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Panama'
  });
}

function fmtDay(day: string): string {
  // `day` es una fecha de Panamá "YYYY-MM-DD"; mostrarla sin desplazar zona.
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-PA', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC'
  });
}

const num: React.CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap' };

/** Tabla con scroll horizontal propio: en móvil nunca desborda la página. */
function Table({ style, children }: { style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto', maxWidth: style?.maxWidth }}>
      <table style={{ ...style, maxWidth: undefined }}>{children}</table>
    </div>
  );
}

/** Barra horizontal CSS (D10: sin librería de gráficos). */
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="img"
      aria-label={label}
      style={{ background: 'var(--surface-2)', borderRadius: 4, height: 10, minWidth: 80 }}
    >
      <div style={{ width: `${width}%`, height: '100%', borderRadius: 4, background: 'var(--accent)' }} />
    </div>
  );
}

function useReport<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await load());
    } catch {
      setError('Error cargando el reporte.');
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload };
}

function Toolbar({
  onRefresh,
  onCsv,
  extra,
  loading
}: {
  onRefresh: () => void;
  onCsv: () => void;
  extra?: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <button className="secondary" onClick={onCsv}>
        Exportar CSV
      </button>
      {extra}
      <button className="secondary" onClick={onRefresh} disabled={loading}>
        {loading ? 'Cargando…' : 'Refrescar'}
      </button>
    </div>
  );
}

export function ReportesTab({ password, event }: { password: string; event: AdminEvent | null }) {
  const [view, setView] = useState<View>(event ? 'cierre' : 'comparativo');
  const [notice, setNotice] = useState('');

  async function csv(kind: string, eventId: string | null) {
    setNotice('');
    try {
      await downloadReportCsv(password, kind, eventId);
    } catch {
      setNotice('No se pudo descargar el CSV.');
    }
  }

  const needsEvent = view !== 'comparativo';

  return (
    <>
      <nav className="tabs" aria-label="Reportes" style={{ marginBottom: 16 }}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`tab ${view === v.key ? 'tab--active' : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </nav>
      {notice && <div className="alert alert--error">{notice}</div>}

      {needsEvent && !event && <p className="muted">Elige un evento para ver este reporte.</p>}
      {view === 'cierre' && event && (
        <CierreView key={event.id} password={password} event={event} onCsv={() => csv('settlement', event.id)} />
      )}
      {view === 'ventas' && event && (
        <VentasView key={event.id} password={password} event={event} onCsv={() => csv('sales-daily', event.id)} />
      )}
      {view === 'asistencia' && event && (
        <AsistenciaView key={event.id} password={password} event={event} onCsv={() => csv('checkin', event.id)} />
      )}
      {view === 'comparativo' && <ComparativoView password={password} onCsv={() => csv('events', null)} />}
    </>
  );
}

// --- Cierre -------------------------------------------------------------------------

function CierreView({ password, event, onCsv }: { password: string; event: AdminEvent; onCsv: () => void }) {
  const load = useCallback(() => fetchSettlementReport(password, event.id), [password, event.id]);
  const { data: s, error, loading, reload } = useReport<SettlementReport>(load);
  const [printError, setPrintError] = useState('');

  // Mismo patrón que el comprobante de reembolso: abrir la pestaña ANTES del
  // await (bloqueadores de popups) y enganchar el botón de imprimir desde aquí,
  // porque la CSP del admin bloquea onclick inline en la pestaña about:blank.
  async function handlePrint() {
    setPrintError('');
    const win = window.open('', '_blank');
    try {
      const html = await fetchSettlementHtml(password, event.id);
      if (!win) {
        setPrintError('Permite las ventanas emergentes para ver el cierre imprimible.');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.document.getElementById('sl-print')?.addEventListener('click', () => win.print());
    } catch {
      if (win) win.close();
      setPrintError('Error al generar el cierre imprimible.');
    }
  }

  const toolbar = (
    <Toolbar
      onRefresh={reload}
      onCsv={onCsv}
      loading={loading}
      extra={<button onClick={handlePrint}>Imprimir / PDF</button>}
    />
  );

  if (!s) return error ? <div className="alert alert--error">{error}</div> : <p className="muted">Cargando…</p>;
  const t = s.totals;

  return (
    <>
      {toolbar}
      {error && <div className="alert alert--error">{error}</div>}
      {printError && <div className="alert alert--error">{printError}</div>}
      {s.preliminary && (
        <div className="alert alert--error">
          <strong>PRELIMINAR</strong> — {s.preliminaryReasons.join(' ')}
        </div>
      )}
      {t.orders === 0 && t.freeTickets === 0 && <p className="muted">Este evento todavía no tiene ventas.</p>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{money(t.finalNetCents)}</div>
            <div className="stat__label">Neto final</div>
          </div>
          <div className="stat">
            <div className="stat__value">{money(t.grossCents)}</div>
            <div className="stat__label">Cobrado (bruto)</div>
          </div>
          <div className="stat">
            <div className="stat__value">{t.soldTickets}</div>
            <div className="stat__label">Vendidas</div>
          </div>
          <div className="stat">
            <div className="stat__value">{t.freeTickets}</div>
            <div className="stat__label">Cortesías + regalos</div>
          </div>
          <div className="stat">
            <div className="stat__value">
              {t.issuedTickets}/{t.capacity}
            </div>
            <div className="stat__label">Ocupación ({pctLabel(t.occupancyPct)})</div>
          </div>
        </div>

        <h3 style={{ marginBottom: 8 }}>Entradas por tipo</h3>
        <Table style={{ maxWidth: 480 }}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th style={num}>Órdenes</th>
              <th style={num}>Entradas</th>
              <th style={num}>Neto</th>
            </tr>
          </thead>
          <tbody>
            {s.tiers.map((x) => (
              <tr key={x.tier}>
                <td>{x.label}</td>
                <td style={num}>{x.orders}</td>
                <td style={num}>{x.tickets}</td>
                <td style={num}>{x.free ? '—' : money(x.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Dinero por método</h2>
        <div style={{ overflowX: 'auto' }}>
          <Table>
            <thead>
              <tr>
                <th>Método</th>
                <th style={num}>Órdenes</th>
                <th style={num}>Bruto</th>
                <th style={num}>Recargo</th>
                <th style={num}>Neto</th>
                <th style={num}>Comisión est.</th>
                <th style={num}>Comisión perdida</th>
                <th style={num}>Depósito esperado</th>
              </tr>
            </thead>
            <tbody>
              {s.byMethod.map((m) => (
                <tr key={m.method}>
                  <td>{METHOD_LABELS[m.method] ?? m.label}</td>
                  <td style={num}>{m.orders}</td>
                  <td style={num}>{money(m.grossCents)}</td>
                  <td style={num}>{money(m.feeCents)}</td>
                  <td style={num}>{money(m.netCents)}</td>
                  <td style={num}>{money(m.processorFeeCents)}</td>
                  <td style={num}>{money(m.lostFeeCents)}</td>
                  <td style={num}>
                    <strong>{money(m.expectedDepositCents)}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td style={num}>{t.orders}</td>
                <td style={num}>{money(t.grossCents)}</td>
                <td style={num}>{money(t.feeCents)}</td>
                <td style={num}>{money(t.netCents)}</td>
                <td style={num}>{money(t.processorFeeCents)}</td>
                <td style={num}>{money(t.lostFeeCents)}</td>
                <td style={num}>
                  <strong>{money(t.expectedDepositCents)}</strong>
                </td>
              </tr>
            </tbody>
          </Table>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Neto {money(t.netCents)} − comisión perdida por reembolsos {money(t.lostFeeCents)} ={' '}
          <strong>neto final {money(t.finalNetCents)}</strong>. Las comisiones son <strong>estimadas</strong>: compara el
          depósito esperado con el estado de cuenta de cada procesador (residuo de redondeo del recargo:{' '}
          {money(t.roundingResidueCents)}). Un reembolso hecho otro día que el pago pierde la comisión de esa orden
          (en CuantoApp es un supuesto sin confirmar).
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>
          Reembolsos ({s.refunds.orders} · {money(s.refunds.refundedCents)} devueltos)
        </h2>
        {s.refunds.list.length === 0 ? (
          <p className="muted">Ninguno.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <th>Comprador</th>
                  <th>Método</th>
                  <th>Pagada</th>
                  <th>Reembolsada</th>
                  <th style={num}>Devuelto</th>
                  <th>¿Mismo día?</th>
                  <th style={num}>Comisión perdida</th>
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {s.refunds.list.map((r) => (
                  <tr key={r.orderId}>
                    <td>{r.buyerName}</td>
                    <td>{METHOD_LABELS[r.method] ?? r.method}</td>
                    <td>{fmtDateTime(r.paidAt)}</td>
                    <td>{fmtDateTime(r.refundedAt)}</td>
                    <td style={num}>{money(r.totalCents)}</td>
                    <td>{r.sameDay === null ? '—' : r.sameDay ? 'Sí' : 'No'}</td>
                    <td style={num}>{money(r.lostFeeCents)}</td>
                    <td>{r.refundRef ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>
          Efectivo ({s.cash.orders} · {money(s.cash.totalCents)})
        </h2>
        {s.cash.list.length === 0 ? (
          <p className="muted">Ninguna orden en efectivo.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <Table>
                <thead>
                  <tr>
                    <th>Comprador</th>
                    <th style={num}>Entradas</th>
                    <th style={num}>Monto</th>
                    <th>Pagada</th>
                    <th>Nota (texto libre)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.cash.list.map((r) => (
                    <tr key={r.orderId}>
                      <td>{r.buyerName}</td>
                      <td style={num}>{r.quantity}</td>
                      <td style={num}>{money(r.totalCents)}</td>
                      <td>{fmtDateTime(r.paidAt)}</td>
                      <td>{r.note ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              La nota es la que se escribió al marcar pagada; no se agrupa por cobrador porque no es un campo fiable.
            </p>
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Excepciones</h2>
        <h3 style={{ marginBottom: 8 }}>Entradas anuladas sin reembolso ({s.voidUnrefunded.tickets})</h3>
        {s.voidUnrefunded.list.length === 0 ? (
          <p className="muted">Ninguna.</p>
        ) : (
          <>
            <Table style={{ maxWidth: 560 }}>
              <thead>
                <tr>
                  <th>Comprador</th>
                  <th>Método</th>
                  <th style={num}>Entradas de la orden</th>
                  <th style={num}>Anuladas</th>
                </tr>
              </thead>
              <tbody>
                {s.voidUnrefunded.list.map((r) => (
                  <tr key={r.orderId}>
                    <td>{r.buyerName}</td>
                    <td>{METHOD_LABELS[r.method] ?? r.method}</td>
                    <td style={num}>{r.quantity}</td>
                    <td style={num}>{r.voidTickets}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="muted">Revocadas a mano: la orden sigue pagada y su dinero cuenta en el neto.</p>
          </>
        )}
        <h3 style={{ marginBottom: 8 }}>
          Pendientes vigentes ({s.pending.orders} · {money(s.pending.totalCents)} sin cobrar)
        </h3>
        {s.pending.list.length === 0 ? (
          <p className="muted">Ninguna.</p>
        ) : (
          <Table style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th>Comprador</th>
                <th>Método</th>
                <th style={num}>Entradas</th>
                <th style={num}>Monto</th>
                <th>Vence</th>
              </tr>
            </thead>
            <tbody>
              {s.pending.list.map((r) => (
                <tr key={r.orderId}>
                  <td>{r.buyerName}</td>
                  <td>{METHOD_LABELS[r.method] ?? r.method}</td>
                  <td style={num}>{r.quantity}</td>
                  <td style={num}>{money(r.totalCents)}</td>
                  <td>{fmtDateTime(r.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {s.expiredPendingOrders > 0 && (
          <p className="muted">
            {s.expiredPendingOrders} pendiente(s) vencida(s) sin limpiar (no cuentan para nada; Resumen → Limpiar
            pendientes vencidas).
          </p>
        )}
      </div>

      {s.attendance.ended && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Asistencia</h2>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat__value">{s.attendance.used}</div>
              <div className="stat__label">Asistieron</div>
            </div>
            <div className="stat">
              <div className="stat__value">{s.attendance.noShow ?? 0}</div>
              <div className="stat__label">No-show</div>
            </div>
            <div className="stat">
              <div className="stat__value">{pctLabel(s.attendance.rate)}</div>
              <div className="stat__label">Tasa de asistencia</div>
            </div>
          </div>
        </div>
      )}
      <p className="muted" style={{ marginTop: 12 }}>
        Generado {fmtDateTime(s.generatedAt)} (hora de Panamá).
      </p>
    </>
  );
}

// --- Ventas por día -------------------------------------------------------------------

function VentasView({ password, event, onCsv }: { password: string; event: AdminEvent; onCsv: () => void }) {
  const load = useCallback(() => fetchSalesDailyReport(password, event.id), [password, event.id]);
  const { data: r, error, loading, reload } = useReport<SalesDailyReport>(load);

  if (!r) return error ? <div className="alert alert--error">{error}</div> : <p className="muted">Cargando…</p>;
  const maxSold = Math.max(0, ...r.days.map((d) => d.soldTickets));

  return (
    <>
      <Toolbar onRefresh={reload} onCsv={onCsv} loading={loading} />
      {error && <div className="alert alert--error">{error}</div>}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{r.totals.soldTickets}</div>
            <div className="stat__label">Vendidas</div>
          </div>
          <div className="stat">
            <div className="stat__value">{r.totals.freeTickets}</div>
            <div className="stat__label">Cortesías + regalos</div>
          </div>
          <div className="stat">
            <div className="stat__value">{money(r.totals.netCents)}</div>
            <div className="stat__label">Neto (tras reembolsos)</div>
          </div>
        </div>
        <p className="muted">
          Cada venta cuenta el día en que se pagó (hora de Panamá); el efectivo, el día en que se marcó pagado. Los
          reembolsos restan el día en que se hicieron.
        </p>
      </div>
      {r.days.length === 0 ? (
        <p className="muted">Este evento todavía no tiene ventas.</p>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <Table>
            <thead>
              <tr>
                <th>Día</th>
                <th style={num}>Preventa</th>
                <th style={num}>General</th>
                <th style={{ minWidth: 100 }}>Vendidas</th>
                <th style={num}>Cort./Reg.</th>
                <th style={num}>Neto</th>
                <th style={num}>Reembolsos</th>
                <th style={num}>Acumuladas</th>
                <th style={num}>% aforo</th>
              </tr>
            </thead>
            <tbody>
              {r.days.map((d) => (
                <tr key={d.day}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(d.day)}</td>
                  <td style={num}>{d.preventaTickets}</td>
                  <td style={num}>{d.generalTickets}</td>
                  <td>
                    <Bar value={d.soldTickets} max={maxSold} label={`${d.soldTickets} vendidas`} />
                  </td>
                  <td style={num}>{d.freeTickets}</td>
                  <td style={num}>{money(d.netCents)}</td>
                  <td style={num}>{d.refundedNetCents ? money(-d.refundedNetCents) : '—'}</td>
                  <td style={num}>{d.cumulativeTickets}</td>
                  <td style={num}>{pctLabel(d.cumulativeCapacityPct)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}

// --- Asistencia -------------------------------------------------------------------------

function AsistenciaView({ password, event, onCsv }: { password: string; event: AdminEvent; onCsv: () => void }) {
  const load = useCallback(() => fetchCheckinReport(password, event.id), [password, event.id]);
  const { data: r, error, loading, reload } = useReport<CheckinReport>(load);

  if (!r) return error ? <div className="alert alert--error">{error}</div> : <p className="muted">Cargando…</p>;
  const maxSlot = Math.max(0, ...r.slots.map((s) => s.tickets));
  const maxStation = Math.max(0, ...r.stations.map((s) => s.tickets));

  return (
    <>
      <Toolbar onRefresh={reload} onCsv={onCsv} loading={loading} />
      {error && <div className="alert alert--error">{error}</div>}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat__value">{r.totals.issued}</div>
            <div className="stat__label">Emitidas</div>
          </div>
          <div className="stat">
            <div className="stat__value">{r.totals.used}</div>
            <div className="stat__label">Asistieron</div>
          </div>
          <div className="stat">
            <div className="stat__value">{r.totals.noShow ?? '—'}</div>
            <div className="stat__label">No-show</div>
          </div>
          <div className="stat">
            <div className="stat__value">{pctLabel(r.totals.rate)}</div>
            <div className="stat__label">Tasa</div>
          </div>
        </div>
        {!r.ended && (
          <p className="muted">
            El evento no ha terminado: el no-show se calcula al final. Para seguir la puerta en vivo usa la pestaña
            Check-in.
          </p>
        )}
      </div>

      {r.slots.length === 0 ? (
        <p className="muted">Todavía no se ha validado ninguna entrada.</p>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Llegadas cada 15 minutos</h2>
          <Table>
            <thead>
              <tr>
                <th>Franja</th>
                <th style={num}>Entradas</th>
                <th style={{ minWidth: 120 }} />
                <th style={num}>Acumulado</th>
                <th style={num}>% emitidas</th>
              </tr>
            </thead>
            <tbody>
              {r.slots.map((s) => (
                <tr key={s.slot}>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.slot.slice(11)}</td>
                  <td style={num}>{s.tickets}</td>
                  <td>
                    <Bar value={s.tickets} max={maxSlot} label={`${s.tickets} llegadas`} />
                  </td>
                  <td style={num}>{s.cumulative}</td>
                  <td style={num}>{pctLabel(s.cumulativePct)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Por estación</h2>
        {r.stations.length === 0 ? (
          <p className="muted">Sin validaciones.</p>
        ) : (
          <Table style={{ maxWidth: 480 }}>
            <tbody>
              {r.stations.map((s) => (
                <tr key={s.station}>
                  <td>{s.station}</td>
                  <td style={num}>{s.tickets}</td>
                  <td style={{ width: '50%' }}>
                    <Bar value={s.tickets} max={maxStation} label={`${s.tickets} validadas`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="muted">El nombre de la estación es el texto que se escribió en /validar.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Por tipo</h2>
        <Table style={{ maxWidth: 560 }}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th style={num}>Emitidas</th>
              <th style={num}>Asistieron</th>
              <th style={num}>No-show</th>
              <th style={num}>Tasa</th>
            </tr>
          </thead>
          <tbody>
            {r.tiers.map((t) => (
              <tr key={t.tier}>
                <td>{t.label}</td>
                <td style={num}>{t.issued}</td>
                <td style={num}>{t.used}</td>
                <td style={num}>{t.noShow ?? '—'}</td>
                <td style={num}>{pctLabel(t.rate)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}

// --- Comparativo --------------------------------------------------------------------------

function ComparativoView({ password, onCsv }: { password: string; onCsv: () => void }) {
  const load = useCallback(() => fetchEventsComparisonReport(password), [password]);
  const { data: r, error, loading, reload } = useReport<EventsComparisonReport>(load);

  if (!r) return error ? <div className="alert alert--error">{error}</div> : <p className="muted">Cargando…</p>;

  return (
    <>
      <Toolbar onRefresh={reload} onCsv={onCsv} loading={loading} />
      {error && <div className="alert alert--error">{error}</div>}
      {r.events.length === 0 ? (
        <p className="muted">No hay eventos publicados todavía.</p>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <Table>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th style={num}>Vendidas</th>
                <th style={num}>Cort./Reg.</th>
                <th style={{ minWidth: 110 }}>Ocupación</th>
                <th style={num}>Neto</th>
                <th style={num}>Reembolsado</th>
                <th style={num}>Días en venta</th>
                <th>Sold-out</th>
                <th style={num}>Asistencia</th>
              </tr>
            </thead>
            <tbody>
              {r.events.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.startsAt)}</td>
                  <td>{STATUS_LABELS[e.status] ?? e.status}</td>
                  <td style={num}>
                    {e.soldTickets}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {e.preventaSold} prev. · {e.generalSold} gral.
                    </div>
                  </td>
                  <td style={num}>{e.freeIssued}</td>
                  <td>
                    <Bar value={e.issuedTickets} max={e.capacity} label={`${e.issuedTickets} de ${e.capacity}`} />
                    <div className="muted" style={{ fontSize: 12 }}>
                      {e.issuedTickets}/{e.capacity} ({pctLabel(e.occupancyPct)})
                    </div>
                  </td>
                  <td style={num}>{money(e.netCents)}</td>
                  <td style={num}>{e.refundedOrders ? money(e.refundedCents) : '—'}</td>
                  <td style={num}>{e.daysOnSale}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.soldOutAt)}</td>
                  <td style={num}>{pctLabel(e.attendanceRate)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
