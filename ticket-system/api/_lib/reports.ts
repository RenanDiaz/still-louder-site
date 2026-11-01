// =============================================================================
// Reportes del admin (docs/features/reportes-admin.md) — SERVER-ONLY.
// =============================================================================
// Postgres agrega (supabase/migrations/0018_reports.sql); aquí se derivan las
// comisiones (D5/D11), se arma el JSON de cada reporte y se formatea a CSV o
// al HTML imprimible del cierre. Rutas: GET /api/admin/reports/* (api/admin.ts,
// solo admin).
//
// Nada se trunca en silencio: toda lectura de filas pagina con .range()
// (fetchAll) hasta agotar el resultado.
// =============================================================================

import { getSupabase } from './supabase.js';
import { type ApiRequest, type ApiResponse, sendHtml, sendJson } from './http.js';
import { estimateProcessorFeeCents } from './pricing.js';
import { escapeHtml, formatPanamaDate } from './receipt.js';
import { formatEventDateTime, type EventRow } from './events.js';
import type { PaymentMethod } from './types.js';

// --- Utilidades ------------------------------------------------------------------

const PAGE = 1000;
const PANAMA_OFFSET_MS = 5 * 60 * 60 * 1000; // America/Panama = UTC−5 todo el año (D3)

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Lee TODAS las filas de una consulta paginando de a 1000 (PostgREST trunca a max_rows). */
async function fetchAll<T>(label: string, page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label} failed: ${error.message}`);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
  }
}

function rpcAll<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  return fetchAll<T>(fn, (from, to) => getSupabase().rpc(fn, args).range(from, to) as unknown as PageResult<T>);
}

/** "2026-10-31 21:15" en hora de Panamá (para CSV). Vacío si no hay fecha. */
export function panamaDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms - PANAMA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** "2026-10-31" de hoy en Panamá (nombres de archivo). */
function panamaToday(): string {
  return new Date(Date.now() - PANAMA_OFFSET_MS).toISOString().slice(0, 10);
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function money(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export type CsvCell = string | number | boolean | null | undefined;

// D7: una celda que empiece con = + - @ (o tab/CR) se prefija con ' para que
// Excel/Sheets no la evalúe como fórmula. Los números propios no se tocan
// (un monto negativo nuestro sí debe seguir siendo número).
function csvCell(cell: CsvCell): string {
  if (cell == null) return '';
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'boolean') return cell ? 'sí' : 'no';
  let s = cell;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con BOM (Excel abre bien los acentos) y fin de línea CRLF. */
export function toCsv(rows: CsvCell[][]): string {
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function sendCsv(res: ApiResponse, filename: string, rows: CsvCell[][]): void {
  res.status(200).setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, '-')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(toCsv(rows));
}

const TIER_LABEL: Record<string, string> = {
  preventa: 'Preventa',
  general: 'General',
  cortesia: 'Cortesía',
  regalo: 'Regalo'
};

const METHOD_LABEL: Record<string, string> = {
  yappy: 'Yappy',
  cuantoapp: 'Tarjeta (CuantoApp)',
  cash: 'Efectivo',
  courtesy: 'Cortesía',
  gift: 'Regalo'
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada',
  refunded: 'Reembolsada'
};

const TICKET_STATUS_LABEL: Record<string, string> = { valid: 'Válida', used: 'Usada', void: 'Anulada' };

const SOLD_TIERS = ['preventa', 'general'];
const FREE_TIERS = ['cortesia', 'regalo'];
/** Métodos que mueven dinero; cortesía/regalo son $0. */
export const MONEY_METHODS: PaymentMethod[] = ['yappy', 'cuantoapp', 'cash'];

// --- Cierre: agregados -------------------------------------------------------------

export interface SettlementGroup {
  status: string; // paid | refunded | pending (vigente) | expired | cancelled
  tier: string;
  payment_method: PaymentMethod;
  refunded_same_day: boolean | null;
  orders: number;
  tickets: number;
  total_cents: number;
  net_cents: number;
  fee_cents: number;
}

export async function fetchSettlementGroups(eventId: string): Promise<SettlementGroup[]> {
  const rows = await rpcAll<SettlementGroup>('report_settlement', { p_event_id: eventId });
  // bigint llega como number o string según el tamaño; normalizar.
  return rows.map((r) => ({
    ...r,
    orders: Number(r.orders),
    tickets: Number(r.tickets),
    total_cents: Number(r.total_cents),
    net_cents: Number(r.net_cents),
    fee_cents: Number(r.fee_cents)
  }));
}

/**
 * D11 — comisión perdida por un reembolso: si el reembolso cayó otro día de
 * Panamá que el pago, el procesador se queda su comisión. Misma regla para
 * Yappy y CuantoApp (CuantoApp: supuesto sin verificar). Si se confirma otra
 * regla para un método, cambiarla SOLO aquí.
 */
export function refundFeeLostCents(
  method: PaymentMethod,
  sameDay: boolean | null,
  totalCents: number,
  orders: number
): number {
  if (sameDay !== false) return 0;
  if (method !== 'yappy' && method !== 'cuantoapp') return 0;
  return estimateProcessorFeeCents(method, totalCents, orders);
}

/**
 * Las stats de ventas del tab Resumen (shape histórico de GET /api/admin/orders),
 * ahora derivadas de report_settlement (D2): mismos números que el Cierre.
 */
export function salesStatsFromGroups(groups: SettlementGroup[]) {
  const paid = groups.filter((g) => g.status === 'paid');
  const refunded = groups.filter((g) => g.status === 'refunded');
  const sum = (rows: SettlementGroup[], key: 'tickets' | 'orders' | 'total_cents' | 'net_cents' | 'fee_cents') =>
    rows.reduce((acc, g) => acc + g[key], 0);
  const revenueByMethod: Record<string, number> = { yappy: 0, cuantoapp: 0, cash: 0 };
  for (const g of paid) {
    if (g.payment_method in revenueByMethod) revenueByMethod[g.payment_method] += g.net_cents;
  }
  return {
    generalPaid: sum(paid.filter((g) => g.tier === 'general'), 'tickets'),
    courtesyTickets: sum(paid.filter((g) => g.tier === 'cortesia'), 'tickets'),
    totalTicketsPaid: sum(paid, 'tickets'),
    revenueCents: sum(paid, 'net_cents'),
    feesCents: sum(paid, 'fee_cents'),
    grossCents: sum(paid, 'total_cents'),
    revenueByMethod,
    refundedOrders: sum(refunded, 'orders'),
    refundedTickets: sum(refunded, 'tickets'),
    refundedGrossCents: sum(refunded, 'total_cents')
  };
}

// --- Cierre: listas y entradas ------------------------------------------------------

interface SettlementListRow {
  kind: 'refunded' | 'cash' | 'void_unpaid' | 'pending';
  order_id: string;
  buyer_name: string;
  tier: string;
  payment_method: PaymentMethod;
  quantity: number;
  total_cents: number;
  net_cents: number;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  reservation_expires_at: string | null;
  payment_ref: string | null;
  refund_ref: string | null;
  void_tickets: number;
}

interface TicketBreakdownRow {
  tier: string;
  status: 'valid' | 'used' | 'void';
  used_by: string | null;
  tickets: number;
}

function sameDayPanama(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  return panamaDateTime(a).slice(0, 10) === panamaDateTime(b).slice(0, 10);
}

interface Attendance {
  issued: number;
  used: number;
  valid: number;
  /** Solo si el evento ya terminó; antes, una entrada válida no es un no-show. */
  noShow: number | null;
  rate: number | null;
}

function attendanceOf(rows: TicketBreakdownRow[], ended: boolean): Attendance {
  const used = rows.filter((r) => r.status === 'used').reduce((a, r) => a + r.tickets, 0);
  const valid = rows.filter((r) => r.status === 'valid').reduce((a, r) => a + r.tickets, 0);
  const issued = used + valid;
  return { issued, used, valid, noShow: ended ? valid : null, rate: pct(used, issued) };
}

function eventSummary(event: EventRow) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    venue: event.venue,
    startsAt: event.starts_at,
    eventEnd: event.event_end,
    status: event.status,
    totalCapacity: event.total_capacity
  };
}

// --- 1. Cierre ------------------------------------------------------------------------

export async function buildSettlement(event: EventRow) {
  const [groups, lists, ticketRows] = await Promise.all([
    fetchSettlementGroups(event.id),
    rpcAll<SettlementListRow>('report_settlement_lists', { p_event_id: event.id }),
    rpcAll<TicketBreakdownRow>('report_ticket_breakdown', { p_event_id: event.id })
  ]);
  const now = Date.now();
  const ended = now >= new Date(event.event_end).getTime();

  const paid = groups.filter((g) => g.status === 'paid');
  const refunded = groups.filter((g) => g.status === 'refunded');
  const pendingGroups = groups.filter((g) => g.status === 'pending');

  const tiers = [...SOLD_TIERS, ...FREE_TIERS].map((tier) => {
    const rows = paid.filter((g) => g.tier === tier);
    return {
      tier,
      label: TIER_LABEL[tier] ?? tier,
      free: FREE_TIERS.includes(tier),
      orders: rows.reduce((a, g) => a + g.orders, 0),
      tickets: rows.reduce((a, g) => a + g.tickets, 0),
      netCents: rows.reduce((a, g) => a + g.net_cents, 0)
    };
  });

  const byMethod = MONEY_METHODS.map((method) => {
    const rows = paid.filter((g) => g.payment_method === method);
    const gross = rows.reduce((a, g) => a + g.total_cents, 0);
    const orders = rows.reduce((a, g) => a + g.orders, 0);
    const processorFee = estimateProcessorFeeCents(method, gross, orders);
    const lostFee = refunded
      .filter((g) => g.payment_method === method)
      .reduce((a, g) => a + refundFeeLostCents(method, g.refunded_same_day, g.total_cents, g.orders), 0);
    return {
      method,
      label: METHOD_LABEL[method],
      orders,
      tickets: rows.reduce((a, g) => a + g.tickets, 0),
      grossCents: gross,
      feeCents: rows.reduce((a, g) => a + g.fee_cents, 0),
      netCents: rows.reduce((a, g) => a + g.net_cents, 0),
      processorFeeCents: processorFee,
      lostFeeCents: lostFee,
      expectedDepositCents: gross - processorFee - lostFee
    };
  });

  const total = (key: keyof (typeof byMethod)[number]) =>
    byMethod.reduce((a, m) => a + (typeof m[key] === 'number' ? (m[key] as number) : 0), 0);
  const soldTickets = tiers.filter((t) => !t.free).reduce((a, t) => a + t.tickets, 0);
  const freeTickets = tiers.filter((t) => t.free).reduce((a, t) => a + t.tickets, 0);
  const attendance = attendanceOf(ticketRows, ended);

  const refundList = lists
    .filter((r) => r.kind === 'refunded')
    .map((r) => {
      const sameDay = sameDayPanama(r.paid_at, r.refunded_at);
      return {
        orderId: r.order_id,
        buyerName: r.buyer_name,
        method: r.payment_method,
        tier: r.tier,
        quantity: r.quantity,
        totalCents: r.total_cents,
        paidAt: r.paid_at,
        refundedAt: r.refunded_at,
        sameDay,
        lostFeeCents: refundFeeLostCents(r.payment_method, sameDay, r.total_cents, 1),
        refundRef: r.refund_ref
      };
    });
  const cashList = lists
    .filter((r) => r.kind === 'cash')
    .map((r) => ({
      orderId: r.order_id,
      buyerName: r.buyer_name,
      tier: r.tier,
      quantity: r.quantity,
      totalCents: r.total_cents,
      paidAt: r.paid_at,
      note: r.payment_ref
    }));
  const voidUnrefunded = lists
    .filter((r) => r.kind === 'void_unpaid')
    .map((r) => ({
      orderId: r.order_id,
      buyerName: r.buyer_name,
      method: r.payment_method,
      tier: r.tier,
      quantity: r.quantity,
      voidTickets: r.void_tickets,
      netCents: r.net_cents
    }));
  const pendingList = lists
    .filter((r) => r.kind === 'pending')
    .map((r) => ({
      orderId: r.order_id,
      buyerName: r.buyer_name,
      method: r.payment_method,
      tier: r.tier,
      quantity: r.quantity,
      totalCents: r.total_cents,
      createdAt: r.created_at,
      expiresAt: r.reservation_expires_at
    }));

  const preliminaryReasons: string[] = [];
  if (!ended) preliminaryReasons.push('El evento todavía no termina.');
  if (pendingList.length > 0) preliminaryReasons.push(`Hay ${pendingList.length} orden(es) pendiente(s) vigente(s).`);

  const netCents = total('netCents');
  const lostFeeCents = total('lostFeeCents');
  return {
    event: eventSummary(event),
    generatedAt: new Date(now).toISOString(),
    preliminary: preliminaryReasons.length > 0,
    preliminaryReasons,
    tiers,
    totals: {
      soldTickets,
      freeTickets,
      issuedTickets: attendance.issued,
      capacity: event.total_capacity,
      occupancyPct: pct(attendance.issued, event.total_capacity),
      orders: total('orders'),
      grossCents: total('grossCents'),
      feeCents: total('feeCents'),
      netCents,
      processorFeeCents: total('processorFeeCents'),
      roundingResidueCents: total('feeCents') - total('processorFeeCents'),
      lostFeeCents,
      expectedDepositCents: total('expectedDepositCents'),
      finalNetCents: netCents - lostFeeCents
    },
    byMethod,
    refunds: {
      orders: refunded.reduce((a, g) => a + g.orders, 0),
      tickets: refunded.reduce((a, g) => a + g.tickets, 0),
      refundedCents: refunded.reduce((a, g) => a + g.total_cents, 0),
      lostFeeCents,
      list: refundList
    },
    cash: {
      orders: cashList.length,
      tickets: cashList.reduce((a, r) => a + r.quantity, 0),
      totalCents: cashList.reduce((a, r) => a + r.totalCents, 0),
      list: cashList
    },
    voidUnrefunded: {
      tickets: voidUnrefunded.reduce((a, r) => a + r.voidTickets, 0),
      list: voidUnrefunded
    },
    pending: {
      orders: pendingGroups.reduce((a, g) => a + g.orders, 0),
      tickets: pendingGroups.reduce((a, g) => a + g.tickets, 0),
      totalCents: pendingGroups.reduce((a, g) => a + g.total_cents, 0),
      list: pendingList
    },
    expiredPendingOrders: groups.filter((g) => g.status === 'expired').reduce((a, g) => a + g.orders, 0),
    attendance: { ...attendance, ended }
  };
}

export type Settlement = Awaited<ReturnType<typeof buildSettlement>>;

function settlementCsv(s: Settlement): CsvCell[][] {
  const header = [
    'seccion',
    'concepto',
    'metodo',
    'ordenes',
    'entradas',
    'bruto',
    'recargo',
    'neto',
    'comision_estimada',
    'comision_perdida',
    'deposito_esperado'
  ];
  const rows: CsvCell[][] = [header];
  for (const t of s.tiers) {
    rows.push(['entradas', t.label, '', t.orders, t.tickets, '', '', dollars(t.netCents), '', '', '']);
  }
  for (const m of s.byMethod) {
    rows.push([
      'dinero',
      'por metodo',
      m.label,
      m.orders,
      m.tickets,
      dollars(m.grossCents),
      dollars(m.feeCents),
      dollars(m.netCents),
      dollars(m.processorFeeCents),
      dollars(m.lostFeeCents),
      dollars(m.expectedDepositCents)
    ]);
  }
  const t = s.totals;
  rows.push([
    'dinero',
    'total',
    '',
    t.orders,
    t.soldTickets,
    dollars(t.grossCents),
    dollars(t.feeCents),
    dollars(t.netCents),
    dollars(t.processorFeeCents),
    dollars(t.lostFeeCents),
    dollars(t.expectedDepositCents)
  ]);
  rows.push(['dinero', 'neto final', '', '', '', '', '', dollars(t.finalNetCents), '', '', '']);
  rows.push(['dinero', 'residuo de redondeo', '', '', '', '', dollars(t.roundingResidueCents), '', '', '', '']);
  rows.push([
    'reembolsos',
    'total',
    '',
    s.refunds.orders,
    s.refunds.tickets,
    dollars(s.refunds.refundedCents),
    '',
    '',
    '',
    dollars(s.refunds.lostFeeCents),
    ''
  ]);
  rows.push(['efectivo', 'total', 'Efectivo', s.cash.orders, s.cash.tickets, dollars(s.cash.totalCents), '', '', '', '', '']);
  rows.push(['excepciones', 'anuladas sin reembolso', '', s.voidUnrefunded.list.length, s.voidUnrefunded.tickets, '', '', '', '', '', '']);
  rows.push(['excepciones', 'pendientes vigentes', '', s.pending.orders, s.pending.tickets, dollars(s.pending.totalCents), '', '', '', '', '']);
  rows.push(['asistencia', 'emitidas', '', '', s.attendance.issued, '', '', '', '', '', '']);
  rows.push(['asistencia', 'asistieron', '', '', s.attendance.used, '', '', '', '', '', '']);
  if (s.attendance.noShow !== null) {
    rows.push(['asistencia', 'no-show', '', '', s.attendance.noShow, '', '', '', '', '', '']);
  }
  return rows;
}

// --- Cierre: imprimible (D8) --------------------------------------------------------------

export function buildSettlementHtml(s: Settlement, event: EventRow): string {
  const e = (v: string | null | undefined) => escapeHtml(v ?? '');
  const t = s.totals;
  const eventLine = [event.venue, formatEventDateTime(event)].filter(Boolean).map((v) => e(v)).join(' · ');
  const td = (v: string | number, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;
  const num = (v: string | number) => td(v, 'num');

  const tierRows = s.tiers
    .map((x) => `<tr>${td(e(x.label))}${num(x.orders)}${num(x.tickets)}${num(x.free ? '—' : money(x.netCents))}</tr>`)
    .join('');

  const methodRows = s.byMethod
    .map(
      (m) =>
        `<tr>${td(e(m.label))}${num(m.orders)}${num(m.tickets)}${num(money(m.grossCents))}${num(
          money(m.feeCents)
        )}${num(money(m.netCents))}${num(money(m.processorFeeCents))}${num(money(m.lostFeeCents))}${num(
          `<strong>${money(m.expectedDepositCents)}</strong>`
        )}</tr>`
    )
    .join('');

  const refundRows = s.refunds.list
    .map(
      (r) =>
        `<tr>${td(e(r.buyerName))}${td(e(METHOD_LABEL[r.method] ?? r.method))}${td(e(panamaDateTime(r.paidAt)))}${td(
          e(panamaDateTime(r.refundedAt))
        )}${num(money(r.totalCents))}${td(r.sameDay === null ? '—' : r.sameDay ? 'Sí' : 'No')}${num(
          money(r.lostFeeCents)
        )}${td(e(r.refundRef))}</tr>`
    )
    .join('');

  const cashRows = s.cash.list
    .map(
      (r) =>
        `<tr>${td(e(r.buyerName))}${num(r.quantity)}${num(money(r.totalCents))}${td(e(panamaDateTime(r.paidAt)))}${td(
          e(r.note) || '<span class="muted">—</span>'
        )}</tr>`
    )
    .join('');

  const voidRows = s.voidUnrefunded.list
    .map((r) => `<tr>${td(e(r.buyerName))}${td(e(METHOD_LABEL[r.method] ?? r.method))}${num(r.quantity)}${num(r.voidTickets)}</tr>`)
    .join('');

  const pendingRows = s.pending.list
    .map(
      (r) =>
        `<tr>${td(e(r.buyerName))}${td(e(METHOD_LABEL[r.method] ?? r.method))}${num(r.quantity)}${num(
          money(r.totalCents)
        )}${td(e(panamaDateTime(r.expiresAt)))}</tr>`
    )
    .join('');

  const a = s.attendance;
  const attendanceBlock = a.ended
    ? `<h2>Asistencia</h2>
       <table class="kv">
         <tr><th>Entradas emitidas</th>${num(a.issued)}</tr>
         <tr><th>Asistieron</th>${num(a.used)}</tr>
         <tr><th>No-show</th>${num(a.noShow ?? 0)}</tr>
         <tr><th>Tasa de asistencia</th>${num(a.rate === null ? '—' : `${a.rate}%`)}</tr>
       </table>`
    : '';

  const section = (title: string, empty: boolean, body: string) =>
    `<h2>${title}</h2>${empty ? '<p class="muted">Ninguna.</p>' : body}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Cierre — ${e(event.name)}</title>
  <style>
    @page { size: letter; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #ece9f3; font-family: Arial, Helvetica, sans-serif; color: #15121c; padding: 20px 12px; font-size: 13px; }
    .sheet { max-width: 900px; margin: 0 auto; background: #fff; padding: 28px 32px; border-radius: 10px; }
    .brand { font-family: 'Arial Black', Arial, sans-serif; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #ff2e93; }
    h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 26px; margin: 4px 0 2px; color: #3e2768; }
    h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 17px; color: #3e2768; margin: 22px 0 6px; border-bottom: 2px solid #3e2768; padding-bottom: 3px; }
    .meta { color: #5a5468; margin-bottom: 4px; }
    .muted { color: #8a8496; }
    .prelim { margin: 14px 0; padding: 10px 14px; border: 2px dashed #c62828; color: #c62828; font-weight: bold; border-radius: 6px; }
    .prelim ul { margin: 4px 0 0; padding-left: 18px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th, td { padding: 5px 6px; border-bottom: 1px solid #e1dfe9; text-align: left; vertical-align: top; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #5a5468; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: bold; border-top: 2px solid #15121c; }
    table.kv { width: auto; min-width: 320px; }
    table.kv th { text-transform: none; font-size: 13px; letter-spacing: 0; color: #15121c; font-weight: normal; }
    .big { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
    .big div { flex: 1 1 150px; background: #f4f0fb; border-left: 4px solid #ff2e93; padding: 8px 12px; border-radius: 6px; }
    .big span { display: block; font-size: 11px; text-transform: uppercase; color: #5a5468; }
    .big strong { font-size: 20px; color: #3e2768; }
    .note { font-size: 11px; color: #5a5468; margin-top: 6px; }
    .sign { display: flex; gap: 40px; margin-top: 48px; }
    .sign div { flex: 1; border-top: 1px solid #15121c; padding-top: 6px; font-size: 12px; }
    .actions { text-align: center; margin: 16px 0 0; }
    .actions button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 0; background: #3e2768; color: #fff; cursor: pointer; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { padding: 0; max-width: none; border-radius: 0; }
      .actions { display: none; }
      h2 { break-after: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="brand">Still Louder · Cierre del evento</div>
    <h1>${e(event.name)}</h1>
    <div class="meta">${eventLine}</div>
    <div class="meta">Generado el ${e(formatPanamaDate(s.generatedAt))} (hora de Panamá)</div>
    ${
      s.preliminary
        ? `<div class="prelim">PRELIMINAR — este cierre todavía puede cambiar.<ul>${s.preliminaryReasons
            .map((r) => `<li>${e(r)}</li>`)
            .join('')}</ul></div>`
        : ''
    }

    <div class="big">
      <div><span>Neto final</span><strong>${money(t.finalNetCents)}</strong></div>
      <div><span>Cobrado (bruto)</span><strong>${money(t.grossCents)}</strong></div>
      <div><span>Entradas vendidas</span><strong>${t.soldTickets}</strong></div>
      <div><span>Ocupación</span><strong>${t.issuedTickets}/${t.capacity}${
        t.occupancyPct === null ? '' : ` (${t.occupancyPct}%)`
      }</strong></div>
    </div>

    <h2>Entradas</h2>
    <table>
      <thead><tr><th>Tipo</th><th class="num">Órdenes</th><th class="num">Entradas</th><th class="num">Neto</th></tr></thead>
      <tbody>${tierRows}</tbody>
    </table>
    <p class="note">Cortesías y regalos son $0: se cuentan como entradas emitidas, nunca como venta.</p>

    <h2>Dinero por método</h2>
    <table>
      <thead><tr><th>Método</th><th class="num">Órdenes</th><th class="num">Entradas</th><th class="num">Bruto</th><th class="num">Recargo</th><th class="num">Neto</th><th class="num">Comisión est.</th><th class="num">Comisión perdida</th><th class="num">Depósito esperado</th></tr></thead>
      <tbody>${methodRows}
        <tr class="total"><td>Total</td>${num(t.orders)}${num(t.soldTickets)}${num(money(t.grossCents))}${num(
          money(t.feeCents)
        )}${num(money(t.netCents))}${num(money(t.processorFeeCents))}${num(money(t.lostFeeCents))}${num(
          money(t.expectedDepositCents)
        )}</tr>
      </tbody>
    </table>
    <table class="kv" style="margin-top:10px">
      <tr><th>Neto (precio base × entradas)</th>${num(money(t.netCents))}</tr>
      <tr><th>− Comisión perdida por reembolsos</th>${num(money(t.lostFeeCents))}</tr>
      <tr class="total"><td>Neto final</td>${num(money(t.finalNetCents))}</tr>
    </table>
    <p class="note">Comisiones <strong>estimadas</strong> con las tarifas de pricing.ts (Yappy 1.07 %, CuantoApp 4.9 % + $0.35 por transacción); compara el depósito esperado con el estado de cuenta de cada procesador. Residuo de redondeo del recargo: ${money(
      t.roundingResidueCents
    )}. Un reembolso hecho otro día que el pago pierde la comisión de esa orden (en CuantoApp es un supuesto sin confirmar).</p>

    ${section(
      `Reembolsos (${s.refunds.orders} orden(es), ${money(s.refunds.refundedCents)} devueltos)`,
      s.refunds.list.length === 0,
      `<table><thead><tr><th>Comprador</th><th>Método</th><th>Pagada</th><th>Reembolsada</th><th class="num">Devuelto</th><th>¿Mismo día?</th><th class="num">Comisión perdida</th><th>Referencia</th></tr></thead><tbody>${refundRows}</tbody></table>`
    )}

    ${section(
      `Efectivo (${s.cash.orders} orden(es), ${money(s.cash.totalCents)})`,
      s.cash.list.length === 0,
      `<table><thead><tr><th>Comprador</th><th class="num">Entradas</th><th class="num">Monto</th><th>Pagada</th><th>Nota (texto libre)</th></tr></thead><tbody>${cashRows}</tbody></table>
       <p class="note">La nota es la que se escribió al marcar la orden como pagada; no es un campo fiable para agrupar por cobrador.</p>`
    )}

    ${section(
      'Entradas anuladas sin reembolso',
      s.voidUnrefunded.list.length === 0,
      `<table><thead><tr><th>Comprador</th><th>Método</th><th class="num">Entradas de la orden</th><th class="num">Anuladas</th></tr></thead><tbody>${voidRows}</tbody></table>
       <p class="note">Revocadas a mano: la orden sigue pagada y su dinero cuenta en el neto.</p>`
    )}

    ${section(
      `Pendientes vigentes (${money(s.pending.totalCents)} sin cobrar)`,
      s.pending.list.length === 0,
      `<table><thead><tr><th>Comprador</th><th>Método</th><th class="num">Entradas</th><th class="num">Monto</th><th>Vence</th></tr></thead><tbody>${pendingRows}</tbody></table>`
    )}

    ${attendanceBlock}

    <div class="sign">
      <div>Preparado por / fecha</div>
      <div>Recibido por / fecha</div>
    </div>
    <div class="actions"><button type="button" id="sl-print">Imprimir / Guardar PDF</button></div>
  </div>
</body>
</html>`;
}

// --- 2. Ventas por día -------------------------------------------------------------------

interface SalesDailyRow {
  day: string;
  paid_orders: number;
  preventa_tickets: number;
  general_tickets: number;
  free_tickets: number;
  gross_cents: number;
  net_cents: number;
  net_yappy: number;
  net_cuantoapp: number;
  net_cash: number;
  refunded_orders: number;
  refunded_tickets: number;
  refunded_net: number;
}

export async function buildSalesDaily(event: EventRow) {
  const raw = await rpcAll<SalesDailyRow>('report_sales_daily', { p_event_id: event.id });
  let cumulative = 0;
  let cumulativeNet = 0;
  const days = raw.map((r) => {
    const n = (v: number) => Number(v);
    const sold = n(r.preventa_tickets) + n(r.general_tickets);
    cumulative += sold + n(r.free_tickets) - n(r.refunded_tickets);
    const dayNet = n(r.net_cents) - n(r.refunded_net);
    cumulativeNet += dayNet;
    return {
      day: r.day,
      paidOrders: n(r.paid_orders),
      preventaTickets: n(r.preventa_tickets),
      generalTickets: n(r.general_tickets),
      soldTickets: sold,
      freeTickets: n(r.free_tickets),
      grossCents: n(r.gross_cents),
      netCents: n(r.net_cents),
      netByMethod: { yappy: n(r.net_yappy), cuantoapp: n(r.net_cuantoapp), cash: n(r.net_cash) },
      refundedOrders: n(r.refunded_orders),
      refundedTickets: n(r.refunded_tickets),
      refundedNetCents: n(r.refunded_net),
      dayNetCents: dayNet,
      cumulativeTickets: cumulative,
      cumulativeNetCents: cumulativeNet,
      cumulativeCapacityPct: pct(cumulative, event.total_capacity)
    };
  });
  return {
    event: eventSummary(event),
    generatedAt: new Date().toISOString(),
    days,
    totals: {
      soldTickets: days.reduce((a, d) => a + d.soldTickets, 0),
      freeTickets: days.reduce((a, d) => a + d.freeTickets, 0),
      netCents: cumulativeNet
    }
  };
}

function salesDailyCsv(r: Awaited<ReturnType<typeof buildSalesDaily>>): CsvCell[][] {
  return [
    [
      'fecha',
      'ordenes_pagadas',
      'entradas_preventa',
      'entradas_general',
      'cortesias_regalos',
      'bruto',
      'neto',
      'neto_yappy',
      'neto_tarjeta',
      'neto_efectivo',
      'reembolsos_ordenes',
      'reembolsos_neto',
      'neto_del_dia',
      'entradas_acumuladas',
      'pct_aforo_acumulado',
      'neto_acumulado'
    ],
    ...r.days.map((d) => [
      d.day,
      d.paidOrders,
      d.preventaTickets,
      d.generalTickets,
      d.freeTickets,
      dollars(d.grossCents),
      dollars(d.netCents),
      dollars(d.netByMethod.yappy),
      dollars(d.netByMethod.cuantoapp),
      dollars(d.netByMethod.cash),
      d.refundedOrders,
      dollars(-d.refundedNetCents),
      dollars(d.dayNetCents),
      d.cumulativeTickets,
      d.cumulativeCapacityPct,
      dollars(d.cumulativeNetCents)
    ])
  ];
}

// --- 3. Asistencia ------------------------------------------------------------------------

export async function buildCheckin(event: EventRow) {
  const [slotsRaw, ticketRows] = await Promise.all([
    rpcAll<{ slot: string; tickets: number }>('report_checkin_slots', { p_event_id: event.id, p_bucket_minutes: 15 }),
    rpcAll<TicketBreakdownRow>('report_ticket_breakdown', { p_event_id: event.id })
  ]);
  const ended = Date.now() >= new Date(event.event_end).getTime();
  const totals = attendanceOf(ticketRows, ended);

  let cumulative = 0;
  const slots = slotsRaw.map((s) => {
    cumulative += Number(s.tickets);
    // `slot` es un timestamp SIN zona ya en hora de Panamá: "2026-10-31T21:15:00".
    return {
      slot: String(s.slot).replace('T', ' ').slice(0, 16),
      tickets: Number(s.tickets),
      cumulative,
      cumulativePct: pct(cumulative, totals.issued)
    };
  });

  const stationMap = new Map<string, number>();
  for (const r of ticketRows) {
    if (r.status !== 'used') continue;
    const key = r.used_by?.trim() || '(sin estación)';
    stationMap.set(key, (stationMap.get(key) ?? 0) + r.tickets);
  }
  const stations = [...stationMap.entries()]
    .map(([station, tickets]) => ({ station, tickets }))
    .sort((a, b) => b.tickets - a.tickets);

  const tierKeys = [...new Set(ticketRows.map((r) => r.tier))].sort(
    (a, b) => [...SOLD_TIERS, ...FREE_TIERS].indexOf(a) - [...SOLD_TIERS, ...FREE_TIERS].indexOf(b)
  );
  const tiers = tierKeys.map((tier) => ({
    tier,
    label: TIER_LABEL[tier] ?? tier,
    ...attendanceOf(
      ticketRows.filter((r) => r.tier === tier),
      ended
    )
  }));

  return { event: eventSummary(event), generatedAt: new Date().toISOString(), ended, totals, slots, stations, tiers };
}

function checkinCsv(r: Awaited<ReturnType<typeof buildCheckin>>): CsvCell[][] {
  const rows: CsvCell[][] = [['seccion', 'concepto', 'entradas', 'acumulado', 'pct', 'emitidas', 'no_show']];
  for (const s of r.slots) rows.push(['franja', s.slot, s.tickets, s.cumulative, s.cumulativePct, '', '']);
  for (const s of r.stations) rows.push(['estacion', s.station, s.tickets, '', '', '', '']);
  for (const t of r.tiers) rows.push(['tarifa', t.label, t.used, '', t.rate, t.issued, t.noShow]);
  rows.push(['total', 'asistieron', r.totals.used, '', r.totals.rate, r.totals.issued, r.totals.noShow]);
  return rows;
}

// --- 4. Comparativo -------------------------------------------------------------------------

interface ComparisonRow {
  event_id: string;
  slug: string;
  name: string;
  status: string;
  starts_at: string;
  event_end: string;
  presale_start: string;
  sales_end: string;
  total_capacity: number;
  preventa_sold: number;
  general_sold: number;
  free_issued: number;
  gross_cents: number;
  net_cents: number;
  refunded_orders: number;
  refunded_cents: number;
  issued_tickets: number;
  used_tickets: number;
  sold_out_at: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildComparison() {
  const raw = await rpcAll<ComparisonRow>('report_events_comparison', {});
  const now = Date.now();
  const events = raw.map((r) => {
    const n = (v: number) => Number(v);
    const ended = now >= new Date(r.event_end).getTime();
    const start = new Date(r.presale_start).getTime();
    const end = Math.min(now, new Date(r.sales_end).getTime());
    return {
      id: r.event_id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      startsAt: r.starts_at,
      capacity: n(r.total_capacity),
      preventaSold: n(r.preventa_sold),
      generalSold: n(r.general_sold),
      soldTickets: n(r.preventa_sold) + n(r.general_sold),
      freeIssued: n(r.free_issued),
      issuedTickets: n(r.issued_tickets),
      occupancyPct: pct(n(r.issued_tickets), n(r.total_capacity)),
      grossCents: n(r.gross_cents),
      netCents: n(r.net_cents),
      refundedOrders: n(r.refunded_orders),
      refundedCents: n(r.refunded_cents),
      daysOnSale: end > start ? Math.ceil((end - start) / DAY_MS) : 0,
      soldOutAt: r.sold_out_at,
      attendanceRate: ended ? pct(n(r.used_tickets), n(r.issued_tickets)) : null
    };
  });
  return { generatedAt: new Date(now).toISOString(), events };
}

function comparisonCsv(r: Awaited<ReturnType<typeof buildComparison>>): CsvCell[][] {
  return [
    [
      'evento',
      'slug',
      'fecha',
      'estado',
      'aforo',
      'vendidas_preventa',
      'vendidas_general',
      'cortesias_regalos',
      'emitidas',
      'pct_ocupacion',
      'neto',
      'bruto',
      'reembolsado',
      'dias_en_venta',
      'sold_out',
      'pct_asistencia'
    ],
    ...r.events.map((e) => [
      e.name,
      e.slug,
      panamaDateTime(e.startsAt),
      e.status,
      e.capacity,
      e.preventaSold,
      e.generalSold,
      e.freeIssued,
      e.issuedTickets,
      e.occupancyPct,
      dollars(e.netCents),
      dollars(e.grossCents),
      dollars(e.refundedCents),
      e.daysOnSale,
      panamaDateTime(e.soldOutAt),
      e.attendanceRate
    ])
  ];
}

// --- 5. Exports de detalle (sin tope, D6) -----------------------------------------------------

interface OrderExportRow {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  tier: string;
  quantity: number;
  net_cents: number;
  fee_cents: number;
  total_cents: number;
  payment_method: string;
  payment_ref: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  refund_ref: string | null;
  order_ref: string | null;
  yappy_transaction_id: string | null;
  marketing_opt_in: boolean;
}

async function ordersCsv(event: EventRow): Promise<CsvCell[][]> {
  const cols =
    'id, buyer_name, buyer_email, buyer_phone, tier, quantity, net_cents, fee_cents, total_cents, payment_method, ' +
    'payment_ref, status, created_at, paid_at, refunded_at, refund_ref, order_ref, yappy_transaction_id, marketing_opt_in';
  const rows = await fetchAll<OrderExportRow>('orders export', (from, to) =>
    getSupabase()
      .from('orders')
      .select(cols)
      .eq('event_id', event.id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<OrderExportRow>
  );
  return [
    [
      'Orden',
      'Comprador',
      'Correo',
      'Teléfono',
      'Tipo',
      'Cantidad',
      'Neto',
      'Cargo por servicio',
      'Total cobrado',
      'Pago',
      'Referencia',
      'Estado',
      'Creada',
      'Pagada',
      'Reembolsada',
      'Ref. reembolso',
      'Ref. Yappy (orden)',
      'Transacción Yappy',
      'Acepta noticias'
    ],
    ...rows.map((o) => [
      o.id,
      o.buyer_name,
      o.buyer_email,
      o.buyer_phone,
      TIER_LABEL[o.tier] ?? o.tier,
      o.quantity,
      dollars(o.net_cents),
      dollars(o.fee_cents),
      dollars(o.total_cents),
      METHOD_LABEL[o.payment_method] ?? o.payment_method,
      o.payment_ref,
      ORDER_STATUS_LABEL[o.status] ?? o.status,
      panamaDateTime(o.created_at),
      panamaDateTime(o.paid_at),
      panamaDateTime(o.refunded_at),
      o.refund_ref,
      o.order_ref,
      o.yappy_transaction_id,
      o.marketing_opt_in
    ])
  ];
}

interface TicketExportRow {
  id: string;
  order_id: string;
  tier: string;
  status: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
  orders: { buyer_name: string; buyer_email: string } | null;
}

async function ticketsCsv(event: EventRow): Promise<CsvCell[][]> {
  const rows = await fetchAll<TicketExportRow>('tickets export', (from, to) =>
    getSupabase()
      .from('tickets')
      .select('id, order_id, tier, status, used_at, used_by, created_at, orders(buyer_name, buyer_email)')
      .eq('event_id', event.id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<TicketExportRow>
  );
  return [
    ['Entrada', 'Orden', 'Comprador', 'Correo', 'Tipo', 'Estado', 'Usada', 'Estación', 'Emitida'],
    ...rows.map((t) => [
      t.id,
      t.order_id,
      t.orders?.buyer_name ?? '',
      t.orders?.buyer_email ?? '',
      TIER_LABEL[t.tier] ?? t.tier,
      TICKET_STATUS_LABEL[t.status] ?? t.status,
      panamaDateTime(t.used_at),
      t.used_by,
      panamaDateTime(t.created_at)
    ])
  ];
}

// --- Router: GET /api/admin/reports/<kind> ----------------------------------------------------

const EVENT_REPORTS = ['settlement', 'sales-daily', 'checkin', 'orders.csv', 'tickets.csv'];
const FILE_PREFIX: Record<string, string> = {
  settlement: 'cierre',
  'sales-daily': 'ventas-por-dia',
  checkin: 'asistencia',
  'orders.csv': 'ordenes',
  'tickets.csv': 'entradas'
};

/**
 * Despacha /api/admin/reports/*. El llamador ya verificó isAdmin y GET.
 * `resolveEvent` es requireEvent de admin.ts (responde 400/404 por sí mismo).
 */
export async function handleReports(
  req: ApiRequest,
  res: ApiResponse,
  segments: string[],
  resolveEvent: () => Promise<EventRow | null>
): Promise<void> {
  const kind = segments.join('/');
  const rawFormat = req.query.format;
  const format = (Array.isArray(rawFormat) ? rawFormat[0] : rawFormat) || 'json';

  if (kind === 'events') {
    if (format !== 'json' && format !== 'csv') return sendJson(res, 400, { error: 'invalid_format' });
    const report = await buildComparison();
    if (format === 'csv') return sendCsv(res, `comparativo-eventos-${panamaToday()}.csv`, comparisonCsv(report));
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, report);
  }

  if (!EVENT_REPORTS.includes(kind)) return sendJson(res, 404, { error: 'not_found' });
  const allowed = kind.endsWith('.csv') ? ['csv'] : kind === 'settlement' ? ['json', 'csv', 'html'] : ['json', 'csv'];
  const effective = kind.endsWith('.csv') ? 'csv' : format;
  if (!allowed.includes(effective)) return sendJson(res, 400, { error: 'invalid_format' });

  const event = await resolveEvent();
  if (!event) return;
  const filename = `${FILE_PREFIX[kind]}-${event.slug}-${panamaToday()}.csv`;

  if (kind === 'orders.csv') return sendCsv(res, filename, await ordersCsv(event));
  if (kind === 'tickets.csv') return sendCsv(res, filename, await ticketsCsv(event));

  if (kind === 'settlement') {
    const report = await buildSettlement(event);
    if (effective === 'csv') return sendCsv(res, filename, settlementCsv(report));
    if (effective === 'html') return sendHtml(res, 200, buildSettlementHtml(report, event));
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, report);
  }
  if (kind === 'sales-daily') {
    const report = await buildSalesDaily(event);
    if (effective === 'csv') return sendCsv(res, filename, salesDailyCsv(report));
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, report);
  }
  // checkin
  const report = await buildCheckin(event);
  if (effective === 'csv') return sendCsv(res, filename, checkinCsv(report));
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, 200, report);
}
