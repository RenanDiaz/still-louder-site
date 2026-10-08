// =============================================================================
// Eventos (autoridad del servidor) — migración 0011, spec multi-evento.md
// =============================================================================
// Cada show es una fila de `events` con sus fechas, caps, aforo, estado y copy;
// los precios viven en `event_tier`. Este módulo reemplaza a las constantes de
// fecha que había en `event.ts` / `pricing.ts` y al espejo del cliente: el
// cliente ya no decide nada, solo dibuja lo que devuelve `presale/status`.
//
//   status   draft → teaser → on_sale → archived   (on_sale → teaser = pausa)
//   fechas   dentro de `on_sale` siguen mandando:
//              presale_start  abre la venta (todas las tarifas)
//              presale_end    desde aquí solo 'general'
//              sales_end      no más órdenes ni regalos
//              event_end      la puerta deja de validar
// =============================================================================

import { getSupabase } from './supabase.js';

export type EventStatus = 'draft' | 'teaser' | 'on_sale' | 'archived';
export type SellableTier = 'preventa' | 'general';
export type StockDisplay = 'always' | 'never' | 'threshold';

export interface EventRow {
  id: string;
  slug: string;
  code: string;
  name: string;
  short_name: string;
  tagline: string | null;
  venue: string | null;
  venue_address: string | null;
  starts_at: string;
  presale_start: string;
  presale_end: string;
  sales_end: string;
  event_end: string;
  presale_stage1_cap: number;
  presale_stage2_cap: number;
  presale_stage2_active: boolean;
  total_capacity: number;
  status: EventStatus;
  theme: string;
  og_image_url: string | null;
  stock_display: StockDisplay;
  stock_display_threshold: number | null;
  created_at: string;
  updated_at: string;
}

export type TierPrices = Record<SellableTier, number>;

export const STOCK_DISPLAYS: StockDisplay[] = ['always', 'never', 'threshold'];
export const EVENT_STATUSES: EventStatus[] = ['draft', 'teaser', 'on_sale', 'archived'];
export const EVENT_CODE_RE = /^[A-Z0-9]{3,8}$/;
export const EVENT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Transiciones válidas. `archived` es terminal; `on_sale → teaser` pausa la venta.
const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['teaser'],
  teaser: ['on_sale'],
  on_sale: ['teaser', 'archived'],
  archived: []
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// --- Lecturas ---------------------------------------------------------------

export async function getEventById(id: string): Promise<EventRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await getSupabase().from('events').select('*').eq('id', id).maybeSingle<EventRow>();
  if (error) throw new Error(`event lookup failed: ${error.message}`);
  return data ?? null;
}

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  if (!EVENT_SLUG_RE.test(slug)) return null;
  const { data, error } = await getSupabase().from('events').select('*').eq('slug', slug).maybeSingle<EventRow>();
  if (error) throw new Error(`event lookup failed: ${error.message}`);
  return data ?? null;
}

/**
 * Evento "actual" (lo que muestra /entradas a secas): el `on_sale` con
 * `starts_at` más cercano que no haya terminado; si no hay, el `teaser` más
 * cercano; si tampoco, el último `archived`. `draft` nunca es público.
 */
export async function getCurrentEvent(now: Date = new Date()): Promise<EventRow | null> {
  const supabase = getSupabase();
  const nowIso = now.toISOString();
  for (const status of ['on_sale', 'teaser'] as const) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('status', status)
      .gt('event_end', nowIso)
      .order('starts_at', { ascending: true })
      .limit(1);
    if (error) throw new Error(`current event lookup failed: ${error.message}`);
    if (data && data.length > 0) return data[0] as EventRow;
  }
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'archived')
    .order('starts_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`current event lookup failed: ${error.message}`);
  return (data?.[0] as EventRow | undefined) ?? null;
}

/** Evento por slug (si viene) o el actual. Un slug de un `draft` no es público. */
export async function resolvePublicEvent(slug: string | undefined | null): Promise<EventRow | null> {
  const ev = slug ? await getEventBySlug(slug) : await getCurrentEvent();
  if (!ev || ev.status === 'draft') return null;
  return ev;
}

export async function getTierPrices(eventId: string): Promise<TierPrices> {
  const { data, error } = await getSupabase()
    .from('event_tier')
    .select('tier, price_cents')
    .eq('event_id', eventId);
  if (error) throw new Error(`event tiers lookup failed: ${error.message}`);
  const prices: TierPrices = { preventa: 0, general: 0 };
  for (const row of (data ?? []) as { tier: SellableTier; price_cents: number }[]) {
    prices[row.tier] = row.price_cents;
  }
  return prices;
}

// --- Reglas de fecha/estado (el servidor manda) -------------------------------

const t = (iso: string) => new Date(iso).getTime();

/** La venta abrió: evento `on_sale` y ya pasó `presale_start`. */
export function areSalesOpen(ev: EventRow, now: Date = new Date()): boolean {
  return ev.status === 'on_sale' && now.getTime() >= t(ev.presale_start);
}

/** La preventa sigue abierta por fecha (el cupo lo decide el RPC). */
export function isPresaleOpen(ev: EventRow, now: Date = new Date()): boolean {
  return now.getTime() < t(ev.presale_end);
}

/** Cerró la venta: pasó `sales_end` o el evento está archivado. */
export function haveSalesEnded(ev: EventRow, now: Date = new Date()): boolean {
  return ev.status === 'archived' || now.getTime() >= t(ev.sales_end);
}

/** La puerta ya no valida (pasó `event_end`). */
export function isEventOver(ev: EventRow, now: Date = new Date()): boolean {
  return now.getTime() >= t(ev.event_end);
}

// --- Presentación -------------------------------------------------------------

/**
 * ¿Puede el público ver este contador de boletos? (spec contador-boletos.md)
 * `threshold` revela el número solo cuando ya es ≤ al umbral.
 */
export function stockVisible(ev: Pick<EventRow, 'stock_display' | 'stock_display_threshold'>, n: number): boolean {
  if (ev.stock_display === 'never') return false;
  if (ev.stock_display === 'threshold') return ev.stock_display_threshold !== null && n <= ev.stock_display_threshold;
  return true; // 'always', or the column not migrated yet (0016): keep the old behavior
}

/** Lo que el público puede ver de un evento (sin caps internos). */
export function publicEvent(ev: EventRow, tiers: TierPrices) {
  return {
    slug: ev.slug,
    code: ev.code,
    name: ev.name,
    shortName: ev.short_name,
    tagline: ev.tagline,
    venue: ev.venue,
    venueAddress: ev.venue_address,
    startsAt: ev.starts_at,
    presaleStart: ev.presale_start,
    presaleEnd: ev.presale_end,
    salesEnd: ev.sales_end,
    eventEnd: ev.event_end,
    status: ev.status,
    theme: ev.theme,
    ogImageUrl: ev.og_image_url,
    tiers
  };
}

const PANAMA = 'America/Panama';

/** "31 de octubre" (hora Panamá). */
export function formatEventDay(ev: Pick<EventRow, 'starts_at'>): string {
  return new Intl.DateTimeFormat('es-PA', { day: 'numeric', month: 'long', timeZone: PANAMA }).format(
    new Date(ev.starts_at)
  );
}

/** "31 de octubre · 8:00 p. m." (hora Panamá). */
export function formatEventDateTime(ev: Pick<EventRow, 'starts_at'>): string {
  const time = new Intl.DateTimeFormat('es-PA', { hour: 'numeric', minute: '2-digit', timeZone: PANAMA }).format(
    new Date(ev.starts_at)
  );
  return `${formatEventDay(ev)} · ${time}`;
}

/** "31 OCT" para cabeceras compactas (boleto del correo). */
export function formatEventShortDay(ev: Pick<EventRow, 'starts_at'>): string {
  const parts = new Intl.DateTimeFormat('es-PA', { day: 'numeric', month: 'short', timeZone: PANAMA }).formatToParts(
    new Date(ev.starts_at)
  );
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace('.', '');
  return `${day} ${month}`.toUpperCase();
}
