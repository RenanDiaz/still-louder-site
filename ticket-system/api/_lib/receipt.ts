import type { Order } from './types.js';

const TIER_LABEL: Record<string, string> = {
  preventa: 'Preventa',
  general: 'General',
  cortesia: 'Cortesía'
};

const METHOD_LABEL: Record<string, string> = {
  yappy: 'Yappy',
  cuantoapp: 'Tarjeta (CuantoApp)',
  cash: 'Efectivo',
  courtesy: 'Cortesía'
};

function formatMoney(totalCents: number): string {
  return `$${(totalCents / 100).toFixed(2)}`;
}

function formatPanamaDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-PA', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Panama'
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Short, human-friendly folio for the document — derived deterministically from
// the order id so the same refund always produces the same receipt number.
function receiptFolio(order: Order): string {
  return `REF-${order.id.slice(0, 8).toUpperCase()}`;
}

/**
 * Builds a self-contained, printable HTML "comprobante de reembolso" for a
 * refunded order. Everything it shows is read from the stored order row
 * (refunded_at, refund_ref, amounts…), so it can be regenerated at any time —
 * even days after the refund happened. The document carries an "Imprimir /
 * Guardar PDF" button (hidden when printing) so staff can keep a PDF copy.
 *
 * The order MUST be in status 'refunded'; callers guard this before rendering.
 */
export function buildRefundReceiptHtml(order: Order): string {
  const tierLabel = TIER_LABEL[order.tier] ?? order.tier;
  const methodLabel = METHOD_LABEL[order.payment_method] ?? order.payment_method;
  const folio = receiptFolio(order);
  const generatedAt = formatPanamaDate(new Date().toISOString());

  const serifFont = "Georgia,'Times New Roman',Times,serif";
  const patchFont = "'Arial Black',Arial,Helvetica,sans-serif";

  const row = (label: string, value: string) => `
        <tr>
          <th>${label}</th>
          <td>${value}</td>
        </tr>`;

  const phoneRow = order.buyer_phone ? row('Teléfono', escapeHtml(order.buyer_phone)) : '';
  const refRow = order.refund_ref ? row('Referencia del reembolso', escapeHtml(order.refund_ref)) : '';
  // Solo desglosamos neto/cargo cuando hubo recargo por servicio.
  const breakdownRows =
    order.fee_cents > 0
      ? row('Subtotal (entradas)', formatMoney(order.net_cents)) +
        row('Cargo por servicio', formatMoney(order.fee_cents))
      : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Comprobante de reembolso ${escapeHtml(folio)} — Still Louder</title>
  <style>
    :root {
      --ink: #15121c;
      --muted: #5a5468;
      --purple: #3e2768;
      --pink: #ff2e93;
      --line: #e1dfe9;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #2c1c4a;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--ink);
      padding: 24px 12px;
    }
    .sheet {
      max-width: 640px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    }
    .header {
      background: var(--purple);
      color: #fff;
      padding: 28px 28px 24px;
      text-align: center;
    }
    .header .brand {
      font-family: ${patchFont};
      font-size: 12px;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #ff6cb6;
      margin-bottom: 10px;
    }
    .header h1 {
      font-family: ${serifFont};
      font-size: 28px;
      line-height: 1.15;
      margin: 0;
    }
    .accent { height: 5px; background: var(--pink); }
    .body { padding: 26px 28px 12px; }
    .meta {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 22px;
    }
    .meta strong { color: var(--ink); }
    .section-title {
      font-family: ${serifFont};
      font-style: italic;
      font-size: 19px;
      color: var(--purple);
      margin: 22px 0 8px;
    }
    table.detail {
      width: 100%;
      border-collapse: collapse;
      font-size: 15px;
    }
    table.detail th {
      text-align: left;
      font-family: ${patchFont};
      font-size: 11px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #8a6db0;
      font-weight: normal;
      padding: 9px 12px 9px 0;
      width: 200px;
      vertical-align: top;
      white-space: nowrap;
    }
    table.detail td {
      padding: 9px 0;
      border-bottom: 1px solid var(--line);
      font-weight: bold;
    }
    .amount {
      margin-top: 22px;
      background: #efe6ff;
      border-left: 5px solid var(--pink);
      border-radius: 10px;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
    }
    .amount .label {
      font-family: ${patchFont};
      font-size: 12px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--purple);
    }
    .amount .value {
      font-family: ${serifFont};
      font-size: 30px;
      color: var(--purple);
    }
    .note {
      margin-top: 22px;
      font-size: 13px;
      line-height: 1.6;
      color: var(--muted);
    }
    .footer {
      background: var(--purple);
      color: #e7dcf7;
      text-align: center;
      padding: 18px 24px;
      font-size: 12px;
      line-height: 1.6;
    }
    .footer a { color: #ff6cb6; text-decoration: none; }
    .toolbar { max-width: 640px; margin: 0 auto 16px; text-align: center; }
    .toolbar button {
      font-family: ${patchFont};
      font-size: 13px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #fff;
      background: var(--pink);
      border: 0;
      border-radius: 8px;
      padding: 13px 26px;
      cursor: pointer;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; border-radius: 0; max-width: none; }
      .toolbar { display: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Imprimir / Guardar PDF</button>
  </div>
  <div class="sheet">
    <div class="header">
      <div class="brand">Still Louder · WWWY3</div>
      <h1>Comprobante de reembolso</h1>
    </div>
    <div class="accent"></div>
    <div class="body">
      <div class="meta">
        <span>Folio: <strong>${escapeHtml(folio)}</strong></span>
        <span>Emitido: <strong>${escapeHtml(generatedAt)}</strong></span>
      </div>

      <div class="section-title">Datos de la orden</div>
      <table class="detail">
        ${row('Orden', `#${escapeHtml(order.id)}`)}
        ${row('Comprador', escapeHtml(order.buyer_name))}
        ${row('Correo', escapeHtml(order.buyer_email))}
        ${phoneRow}
        ${row('Evento', 'When We Were Young 3 · Hops · 1 de agosto')}
        ${row('Tipo', escapeHtml(tierLabel))}
        ${row('Cantidad', `${order.quantity} ${order.quantity === 1 ? 'entrada' : 'entradas'} (anuladas)`)}
        ${row('Método de pago', escapeHtml(methodLabel))}
        ${row('Fecha de pago', escapeHtml(formatPanamaDate(order.paid_at)))}
      </table>

      <div class="section-title">Detalle del reembolso</div>
      <table class="detail">
        ${row('Fecha de reembolso', escapeHtml(formatPanamaDate(order.refunded_at)))}
        ${refRow}
        ${breakdownRows}
      </table>

      <div class="amount">
        <span class="label">Monto reembolsado</span>
        <span class="value">${formatMoney(order.total_cents)}</span>
      </div>

      <p class="note">
        Este documento certifica el reembolso del monto indicado y la anulación
        de las entradas asociadas a la orden #${escapeHtml(order.id)}. Las
        entradas anuladas dejan de ser válidas para el ingreso al evento. La
        devolución del dinero se procesa según el método de pago original.
      </p>
    </div>
    <div class="footer">
      ¿Dudas? Escríbenos por nuestros canales oficiales:
      <a href="https://ig.me/m/still_louder"><strong>@still_louder</strong></a>.
    </div>
  </div>
</body>
</html>`;
}
