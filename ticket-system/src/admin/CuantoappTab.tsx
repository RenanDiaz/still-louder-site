import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCuantoappLinks, type AdminEvent, type CuantoappLinkRow } from '../shared/api';

// =============================================================================
// Pestaña CuantoApp: comprobar los links de pago con tarjeta.
// =============================================================================
// Cada cantidad (1–10) tiene su producto oculto en CuantoApp con el precio ya
// "grossed-up" (ver api/_lib/cuantoapp.ts). Los links viven en las vars
// CUANTOAPP_PAYMENT_URL_<n> del Worker, así que cambiarlos = commit + deploy.
// Esta pestaña muestra, por cantidad, el link que recibiría el comprador y el
// monto exacto que ese producto debe cobrar con los precios del evento.
// CuantoApp no expone una API para leer el precio de un producto: el admin abre
// cada link, compara y lo marca como comprobado. La marca queda en este
// navegador y se invalida sola si cambia el link o el monto.
// =============================================================================

const CHECKED_KEY = 'sl_admin_cuantoapp_checked';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function checkKey(eventId: string, row: CuantoappLinkRow): string {
  return [eventId, row.quantity, row.url, row.amounts.preventa, row.amounts.general].join('|');
}

function loadChecked(): Set<string> {
  try {
    const raw = localStorage.getItem(CHECKED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveChecked(keys: Set<string>) {
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify([...keys]));
  } catch {
    // storage unavailable
  }
}

// Problemas detectables sin abrir el link. El fallback genérico repite la misma
// URL a propósito, así que no cuenta como duplicado.
function problemsOf(row: CuantoappLinkRow, rows: CuantoappLinkRow[]): string[] {
  const problems: string[] = [];
  if (row.source === 'missing') return ['Sin link: el comprador no recibe enlace de pago.'];
  if (row.source === 'fallback') {
    problems.push('Usa el link genérico: no cobra el monto exacto de esta cantidad.');
  }
  let host = '';
  try {
    const parsed = new URL(row.url);
    host = parsed.hostname;
    if (parsed.protocol !== 'https:') problems.push('No es https.');
  } catch {
    problems.push('URL inválida.');
  }
  if (host && host !== 'cuanto.app' && !host.endsWith('.cuanto.app')) problems.push(`Dominio inesperado: ${host}.`);
  if (row.source === 'specific') {
    const dupes = rows
      .filter((r) => r.source === 'specific' && r.quantity !== row.quantity && r.url === row.url)
      .map((r) => r.quantity);
    if (dupes.length > 0) problems.push(`Mismo link que la cantidad ${dupes.join(', ')}.`);
  }
  return problems;
}

export function CuantoappTab({ password, event }: { password: string; event: AdminEvent }) {
  const [rows, setRows] = useState<CuantoappLinkRow[] | null>(null);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<Set<string>>(loadChecked);

  const load = useCallback(async () => {
    setError('');
    try {
      const { links } = await fetchCuantoappLinks(password, event.id);
      setRows(links);
    } catch {
      setError('Error cargando los links de CuantoApp.');
    }
  }, [password, event.id]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(row: CuantoappLinkRow) {
    const key = checkKey(event.id, row);
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveChecked(next);
      return next;
    });
  }

  const problems = useMemo(() => (rows ? rows.map((row) => problemsOf(row, rows)) : []), [rows]);

  if (!rows) {
    return error ? <div className="alert alert--error">{error}</div> : <p className="muted">Cargando…</p>;
  }

  const withProblems = problems.filter((p) => p.length > 0).length;
  const checkedCount = rows.filter((row) => checked.has(checkKey(event.id, row))).length;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Links de CuantoApp</h2>
      <p className="muted">
        Abre cada link y confirma que el producto cobra el monto de la tabla (preventa y general).
        Los montos ya incluyen el recargo de CuantoApp para los precios de este evento. Los links se
        cambian en <code>ticket-system/wrangler.jsonc</code> y requieren un deploy.
      </p>
      {error && <div className="alert alert--error">{error}</div>}
      {withProblems > 0 && (
        <div className="alert alert--error">
          {withProblems} cantidad(es) con problemas: revisa la columna Estado.
        </div>
      )}
      <p>
        Comprobados en este navegador:{' '}
        <strong>
          {checkedCount}/{rows.length}
        </strong>
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Cant.</th>
              <th>Preventa</th>
              <th>General</th>
              <th>Link</th>
              <th>Estado</th>
              <th>Comprobado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const rowProblems = problems[i];
              const isChecked = checked.has(checkKey(event.id, row));
              return (
                <tr key={row.quantity}>
                  <td>{row.quantity}</td>
                  <td>{money(row.amounts.preventa)}</td>
                  <td>{money(row.amounts.general)}</td>
                  <td>
                    {row.url ? (
                      <a href={row.url} target="_blank" rel="noopener noreferrer">
                        {row.url.replace(/^https?:\/\//, '')} ↗
                      </a>
                    ) : (
                      '—'
                    )}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {row.envVar}
                    </div>
                  </td>
                  <td>
                    {rowProblems.length === 0 ? (
                      <span className="badge badge--valid">OK</span>
                    ) : (
                      <>
                        <span className={`badge ${row.source === 'fallback' ? 'badge--pending' : 'badge--void'}`}>
                          Revisar
                        </span>
                        {rowProblems.map((p) => (
                          <div key={p} className="muted" style={{ fontSize: 12 }}>
                            {p}
                          </div>
                        ))}
                      </>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!row.url}
                      onChange={() => toggle(row)}
                      style={{ width: 'auto' }}
                      aria-label={`Link de ${row.quantity} entrada(s) comprobado`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="secondary" onClick={load}>
          Refrescar
        </button>
      </div>
    </div>
  );
}
