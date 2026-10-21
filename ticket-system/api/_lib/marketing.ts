import { Resend } from 'resend';
import { env } from './env.js';
import { getSupabase } from './supabase.js';
import { signWithPrefix, verifyWithPrefix } from './hmac.js';
import { prepareCampaignEmail, type CampaignContent, type ConsentSource } from './marketing-email.js';

// =============================================================================
// Campañas de promoción — lógica de servidor (docs/features/campanas-promocion.md)
// =============================================================================
// Audiencia, token de baja y envío por lotes sobre Resend. La garantía de "un
// correo por (campaña, contacto)" la da claim_wave() en la base (migración
// 0017); este módulo solo envía lo que esa función le entrega y registra el
// resultado. Nada aquí lo importa issue.ts ni sendTicketEmail: una baja jamás
// afecta los correos transaccionales.
// =============================================================================

// Tope de frecuencia (D7): un contacto no recibe más de una campaña cada N días.
// Se pasa a las RPC (marketing_audience / freeze_campaign / claim_wave).
export const FREQUENCY_CAP_DAYS = 14;

// Resend acepta hasta 100 correos por llamada a batch.send.
const RESEND_BATCH_MAX = 100;

// Ola máxima de un envío escalonado (se manda en lotes de 100).
export const MAX_WAVE_SIZE = 1000;

// Presupuesto de un POST …/send en modo inmediato. Un Worker no tiene tope de
// tiempo real mientras el cliente espera, pero sí de subrequests (50 en el
// plan gratis) y de CPU; cada lote cuesta 3 subrequests (claim_wave, Resend,
// record_marketing_results). 8 lotes = 24 subrequests + ~5 de lecturas y
// cierre, con margen en cualquier plan, y 20 s de pared cortan antes de que un
// proxy o el navegador se impacienten. Si queda cola, el endpoint devuelve
// { remaining } y la UI vuelve a llamar.
const IMMEDIATE_MAX_BATCHES = 8;
const IMMEDIATE_TIME_BUDGET_MS = 20_000;

// Límite de Resend: 2 peticiones/s por defecto. Espaciamos los lotes.
const MIN_MS_BETWEEN_BATCHES = 600;

// Un 'sending' sin resend_id de más de esto se puede devolver a la cola (el
// Worker murió entre claim_wave y el registro del resultado).
export const ORPHAN_AFTER_MS = 10 * 60 * 1000;

// Freno entre olas: bajas + fallidos de la ola anterior / enviados.
export const WAVE_BRAKE_RATE = 0.05;

export const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContactStatus = 'subscribed' | 'unsubscribed' | 'bounced' | 'complained';
export type CampaignStatus = 'draft' | 'ready' | 'sending' | 'paused' | 'completed' | 'cancelled';
export type AudienceKind = 'all' | 'tags' | 'events' | 'manual';
export type AudienceOutcome = 'eligible' | 'frequency_cap' | 'no_consent' | ContactStatus;

export interface MarketingContact {
  email: string;
  name: string | null;
  consent_source: ConsentSource;
  status: ContactStatus;
  tags: string[];
  first_order_at: string | null;
  last_order_at: string | null;
  last_campaign_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
}

export interface Audience {
  kind: AudienceKind;
  tags?: string[];
  event_ids?: string[];
  exclude_event_ids?: string[];
  emails?: string[];
  include_legacy?: boolean;
}

export interface MarketingCampaign extends CampaignContent {
  id: string;
  audience: Audience;
  delivery: 'immediate' | 'waves';
  wave_size: number | null;
  status: CampaignStatus;
  test_sent_at: string | null;
  content_updated_at: string;
  frozen_at: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

/** "renan@gmail.com" -> "r***@gmail.com" (para la página de baja y los logs). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

// --- Token de baja ---------------------------------------------------------------
// base64url(email) + '.' + HMAC-SHA256(TICKET_HMAC_SECRET, 'unsub:' + email)
// truncado. El prefijo separa el dominio de las firmas de QR. No expira: una
// baja debe funcionar siempre.
const UNSUB_PREFIX = 'unsub:';

export function makeUnsubscribeToken(email: string): string {
  const normalized = normalizeEmail(email);
  return `${Buffer.from(normalized).toString('base64url')}.${signWithPrefix(UNSUB_PREFIX, normalized)}`;
}

/** Devuelve el correo normalizado si el token es auténtico; si no, null. */
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let email: string;
  try {
    email = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (email !== normalizeEmail(email) || !isValidEmail(email)) return null;
  return verifyWithPrefix(UNSUB_PREFIX, email, parts[1]) ? email : null;
}

export function unsubscribeUrls(email: string): { page: string; oneClick: string } {
  const t = encodeURIComponent(makeUnsubscribeToken(email));
  return {
    page: `${env.publicBaseUrl}/baja?t=${t}`,
    oneClick: `${env.publicBaseUrl}/api/marketing/unsubscribe?t=${t}`
  };
}

/**
 * Baja idempotente. Un contacto que no existe todavía (p. ej. reenviaron el
 * correo de prueba) se crea ya de baja, para que un sync posterior no lo
 * suscriba. bounced/complained se dejan como están (ya no reciben nada).
 */
export async function unsubscribe(email: string): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('marketing_contact')
    .update({ status: 'unsubscribed', unsubscribed_at: now })
    .eq('email', email)
    .eq('status', 'subscribed');
  if (error) throw new Error(`unsubscribe update failed: ${error.message}`);
  const { error: insertError } = await supabase
    .from('marketing_contact')
    .upsert({ email, status: 'unsubscribed', unsubscribed_at: now }, { onConflict: 'email', ignoreDuplicates: true });
  if (insertError) throw new Error(`unsubscribe insert failed: ${insertError.message}`);
}

export async function getContactStatus(email: string): Promise<ContactStatus | null> {
  const { data, error } = await getSupabase()
    .from('marketing_contact')
    .select('status')
    .eq('email', email)
    .maybeSingle<{ status: ContactStatus }>();
  if (error) throw new Error(`contact lookup failed: ${error.message}`);
  return data?.status ?? null;
}

// --- Validación ------------------------------------------------------------------

const AUDIENCE_KINDS: AudienceKind[] = ['all', 'tags', 'events', 'manual'];

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return null;
  return value as string[];
}

export function parseAudience(raw: unknown): Audience | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid_audience' };
  const a = raw as Record<string, unknown>;
  if (!AUDIENCE_KINDS.includes(a.kind as AudienceKind)) return { error: 'invalid_audience_kind' };
  const tags = stringArray(a.tags);
  const eventIds = stringArray(a.event_ids);
  const exclude = stringArray(a.exclude_event_ids);
  const emails = stringArray(a.emails);
  if (!tags || !tags.every((t) => TAG_RE.test(t))) return { error: 'invalid_audience_tags' };
  if (!eventIds || !eventIds.every((id) => UUID_RE.test(id))) return { error: 'invalid_audience_events' };
  if (!exclude || !exclude.every((id) => UUID_RE.test(id))) return { error: 'invalid_audience_events' };
  if (!emails) return { error: 'invalid_audience_emails' };
  const normalized = [...new Set(emails.map(normalizeEmail))];
  if (!normalized.every(isValidEmail) || normalized.length > 5000) return { error: 'invalid_audience_emails' };
  if (a.include_legacy !== undefined && typeof a.include_legacy !== 'boolean') return { error: 'invalid_audience' };

  const kind = a.kind as AudienceKind;
  const audience: Audience = {
    kind,
    tags: [...new Set(tags)],
    event_ids: [...new Set(eventIds)],
    exclude_event_ids: [...new Set(exclude)],
    emails: normalized,
    include_legacy: a.include_legacy === true
  };
  if (kind !== 'all' && !audience.tags!.length && !audience.event_ids!.length && !audience.emails!.length) {
    return { error: 'empty_selection' };
  }
  return audience;
}

function optionalHttps(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : false;
  } catch {
    return false;
  }
}

export type CampaignFields = Partial<
  Pick<
    MarketingCampaign,
    'slug' | 'subject' | 'preheader' | 'body_md' | 'image_url' | 'cta_label' | 'cta_url' | 'audience' | 'delivery' | 'wave_size'
  >
>;

export const CONTENT_FIELDS = ['subject', 'preheader', 'body_md', 'image_url', 'cta_label', 'cta_url'] as const;

/** Valida un cuerpo de creación/edición; solo devuelve los campos presentes. */
export function parseCampaignBody(body: Record<string, unknown>): { fields: CampaignFields } | { error: string } {
  const fields: CampaignFields = {};
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || !SLUG_RE.test(body.slug) || body.slug.length > 60) {
      return { error: 'invalid_slug' };
    }
    fields.slug = body.slug;
  }
  if (body.subject !== undefined) {
    const s = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (s.length < 1 || s.length > 120) return { error: 'invalid_subject' };
    fields.subject = s;
  }
  if (body.preheader !== undefined) {
    const s = typeof body.preheader === 'string' ? body.preheader.trim() : null;
    if (s === null || s.length > 140) return { error: 'invalid_preheader' };
    fields.preheader = s;
  }
  if (body.body_md !== undefined) {
    if (typeof body.body_md !== 'string' || body.body_md.length > 20000) return { error: 'invalid_body' };
    fields.body_md = body.body_md;
  }
  const image = optionalHttps(body.image_url);
  if (image === false) return { error: 'invalid_image_url' };
  if (image !== undefined) fields.image_url = image;
  const ctaUrl = optionalHttps(body.cta_url);
  if (ctaUrl === false) return { error: 'invalid_cta_url' };
  if (ctaUrl !== undefined) fields.cta_url = ctaUrl;
  if (body.cta_label !== undefined) {
    const s = typeof body.cta_label === 'string' ? body.cta_label.trim() : '';
    if (s.length > 40) return { error: 'invalid_cta_label' };
    fields.cta_label = s || null;
  }
  if (body.audience !== undefined) {
    const audience = parseAudience(body.audience);
    if ('error' in audience) return audience;
    fields.audience = audience;
  }
  if (body.delivery !== undefined) {
    if (body.delivery !== 'immediate' && body.delivery !== 'waves') return { error: 'invalid_delivery' };
    fields.delivery = body.delivery;
  }
  if (body.wave_size !== undefined && body.wave_size !== null) {
    const n = Number(body.wave_size);
    if (!Number.isInteger(n) || n < 1 || n > MAX_WAVE_SIZE) return { error: 'invalid_wave_size' };
    fields.wave_size = n;
  }
  return { fields };
}

// --- Lecturas ----------------------------------------------------------------------

// PostgREST corta en 1000 filas; la base es chica pero paginamos igual.
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

export async function syncContacts(): Promise<number> {
  const { data, error } = await getSupabase().rpc('sync_marketing_contacts');
  if (error) throw new Error(`sync_marketing_contacts failed: ${error.message}`);
  return Number(data ?? 0);
}

export async function listContactsWithEvents(): Promise<(MarketingContact & { event_ids: string[] })[]> {
  const supabase = getSupabase();
  const contacts = await fetchAll<MarketingContact>((from, to) =>
    supabase.from('marketing_contact').select('*').order('email').range(from, to)
  );
  const events = await fetchAll<{ email: string; event_ids: string[] }>((from, to) =>
    supabase.rpc('marketing_contact_events').order('email').range(from, to)
  );
  const byEmail = new Map(events.map((e) => [e.email, e.event_ids]));
  return contacts.map((c) => ({ ...c, event_ids: byEmail.get(c.email) ?? [] }));
}

export type AudienceCounts = Record<AudienceOutcome, number>;

/** Cuántos recibirían hoy y cuántos se omiten, por motivo (vista previa). */
export async function countAudience(audience: Audience): Promise<AudienceCounts> {
  const supabase = getSupabase();
  const rows = await fetchAll<{ email: string; outcome: AudienceOutcome }>((from, to) =>
    supabase
      .rpc('marketing_audience', { p_audience: audience, p_frequency_days: FREQUENCY_CAP_DAYS })
      .order('email')
      .range(from, to)
  );
  const counts: AudienceCounts = {
    eligible: 0,
    frequency_cap: 0,
    no_consent: 0,
    subscribed: 0,
    unsubscribed: 0,
    bounced: 0,
    complained: 0
  };
  for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return counts;
}

export interface WaveStats {
  campaign_id: string;
  wave: number | null;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  skipped_unsubscribed: number;
  skipped_bounced: number;
  skipped_complained: number;
  skipped_frequency_cap: number;
  skipped_cancelled: number;
  unsubscribed: number;
  first_sent_at: string | null;
}

export async function campaignStats(campaignId?: string): Promise<WaveStats[]> {
  const { data, error } = await getSupabase().rpc('marketing_campaign_stats', {
    p_campaign_id: campaignId ?? null
  });
  if (error) throw new Error(`marketing_campaign_stats failed: ${error.message}`);
  return (data ?? []) as WaveStats[];
}

/** Bajas + fallidos de la última ola enviada, sobre lo que se intentó enviar. */
export function lastWaveRate(waves: WaveStats[]): { wave: number; rate: number } | null {
  const sentWaves = waves
    .filter((w) => w.wave !== null && w.sent + w.failed > 0)
    .sort((a, b) => (b.wave ?? 0) - (a.wave ?? 0));
  const last = sentWaves[0];
  if (!last) return null;
  return { wave: last.wave!, rate: (last.unsubscribed + last.failed) / (last.sent + last.failed) };
}

// --- Envío ---------------------------------------------------------------------------

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function unsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  // RFC 8058: Gmail/Apple Mail hacen POST a esta URL con el cuerpo
  // "List-Unsubscribe=One-Click", sin abrir la página.
  return {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}

/** Envío de prueba: asunto con [PRUEBA]. No toca marketing_recipient. */
export async function sendTestEmail(campaign: MarketingCampaign, to: string): Promise<void> {
  const email = normalizeEmail(to);
  const render = prepareCampaignEmail(campaign);
  const { data: contact } = await getSupabase()
    .from('marketing_contact')
    .select('name, consent_source')
    .eq('email', email)
    .maybeSingle<{ name: string | null; consent_source: ConsentSource }>();
  const urls = unsubscribeUrls(email);
  const { html, text } = render({
    name: contact?.name ?? null,
    consentSource: contact?.consent_source ?? 'legacy_buyer',
    unsubscribeUrl: urls.page
  });
  const replyTo = env.emailReplyTo;
  const { error } = await getResend().emails.send({
    from: env.campaignEmailFrom,
    to: email,
    ...(replyTo ? { replyTo } : {}),
    subject: `[PRUEBA] ${campaign.subject}`,
    html,
    text,
    headers: unsubscribeHeaders(urls.oneClick)
  });
  if (error) throw new SendError(`resend_${error.name}`);
}

export class SendError extends Error {}

interface ClaimedRecipient {
  recipient_email: string;
  recipient_name: string | null;
  recipient_consent: ConsentSource;
  wave_no: number;
}

async function claimWave(campaignId: string, size: number): Promise<ClaimedRecipient[]> {
  const { data, error } = await getSupabase().rpc('claim_wave', {
    p_campaign_id: campaignId,
    p_size: size,
    p_frequency_days: FREQUENCY_CAP_DAYS
  });
  if (error) throw new Error(`claim_wave failed: ${error.message}`);
  return (data ?? []) as ClaimedRecipient[];
}

async function recordResults(
  campaignId: string,
  results: { email: string; resend_id?: string; error?: string }[]
): Promise<void> {
  const { error } = await getSupabase().rpc('record_marketing_results', {
    p_campaign_id: campaignId,
    p_results: results
  });
  if (error) throw new Error(`record_marketing_results failed: ${error.message}`);
}

/**
 * Envía UN lote (≤ 100) ya reclamado. Idempotency-Key = <campaña>:<ola>:<lote>:
 * si la petición se corta y se reintenta, Resend no la duplica. Un error de
 * Resend (validación, límite) marca el lote 'failed'. Si Resend no responde
 * ni al reintento, el lote se queda en 'sending' (resultado desconocido) y se
 * corta el envío: se puede devolver a la cola tras ORPHAN_AFTER_MS.
 */
async function sendBatch(
  campaign: MarketingCampaign,
  render: ReturnType<typeof prepareCampaignEmail>,
  rows: ClaimedRecipient[],
  chunk: number
): Promise<{ sent: number; failed: number }> {
  const replyTo = env.emailReplyTo;
  const payload = rows.map((r) => {
    const urls = unsubscribeUrls(r.recipient_email);
    const { html, text } = render({ name: r.recipient_name, consentSource: r.recipient_consent, unsubscribeUrl: urls.page });
    return {
      from: env.campaignEmailFrom,
      to: r.recipient_email,
      ...(replyTo ? { replyTo } : {}),
      subject: campaign.subject,
      html,
      text,
      headers: unsubscribeHeaders(urls.oneClick),
      tags: [{ name: 'campaign', value: campaign.slug }]
    };
  });
  const idempotencyKey = `${campaign.id}:${rows[0].wave_no}:${chunk}`;

  let response: Awaited<ReturnType<Resend['batch']['send']>> | null = null;
  for (let attempt = 0; attempt < 2 && !response; attempt++) {
    try {
      response = await getResend().batch.send(payload, { idempotencyKey });
    } catch (err) {
      console.error('[marketing] resend batch threw', campaign.id, idempotencyKey, (err as Error).message);
      if (attempt === 0) await sleep(1000);
    }
  }
  if (!response) throw new SendError('resend_unreachable');

  if (response.error || !response.data) {
    const reason = response.error ? `${response.error.name}: ${response.error.message}` : 'empty_response';
    // Sin el mensaje: puede citar una dirección (sin PII en logs).
    console.error('[marketing] resend batch failed', campaign.id, idempotencyKey, response.error?.name);
    await recordResults(
      campaign.id,
      rows.map((r) => ({ email: r.recipient_email, error: reason }))
    );
    return { sent: 0, failed: rows.length };
  }

  // batch.send responde los ids en el mismo orden del payload.
  const ids = response.data.data ?? [];
  await recordResults(
    campaign.id,
    rows.map((r, i) => (ids[i]?.id ? { email: r.recipient_email, resend_id: ids[i].id } : { email: r.recipient_email, error: 'missing_resend_id' }))
  );
  const sent = rows.filter((_r, i) => ids[i]?.id).length;
  return { sent, failed: rows.length - sent };
}

export interface SendResult {
  sent: number;
  failed: number;
  waves: number[];
  remaining: number;
  status: CampaignStatus;
}

async function countPending(campaignId: string): Promise<{ queued: number; sending: number }> {
  const supabase = getSupabase();
  const [queued, sending] = await Promise.all(
    (['queued', 'sending'] as const).map((status) =>
      supabase
        .from('marketing_recipient')
        .select('email', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', status)
    )
  );
  if (queued.error || sending.error) throw new Error('recipient count failed');
  return { queued: queued.count ?? 0, sending: sending.count ?? 0 };
}

/**
 * immediate: olas internas de 100 hasta agotar la cola o el presupuesto.
 * waves: UNA ola de `size` (en lotes de 100).
 */
export async function sendCampaign(campaign: MarketingCampaign, size?: number): Promise<SendResult> {
  const render = prepareCampaignEmail(campaign);
  const started = Date.now();
  let lastBatchAt = 0;
  const result = { sent: 0, failed: 0, waves: [] as number[] };

  const sendRows = async (rows: ClaimedRecipient[]) => {
    for (let i = 0; i * RESEND_BATCH_MAX < rows.length; i++) {
      const wait = lastBatchAt + MIN_MS_BETWEEN_BATCHES - Date.now();
      if (wait > 0) await sleep(wait);
      lastBatchAt = Date.now();
      const r = await sendBatch(campaign, render, rows.slice(i * RESEND_BATCH_MAX, (i + 1) * RESEND_BATCH_MAX), i);
      result.sent += r.sent;
      result.failed += r.failed;
    }
  };

  if (campaign.delivery === 'waves') {
    const waveSize = Math.min(size ?? campaign.wave_size ?? 20, MAX_WAVE_SIZE);
    const rows = await claimWave(campaign.id, waveSize);
    if (rows.length > 0) {
      result.waves.push(rows[0].wave_no);
      await sendRows(rows);
    }
  } else {
    for (let n = 0; n < IMMEDIATE_MAX_BATCHES && Date.now() - started < IMMEDIATE_TIME_BUDGET_MS; n++) {
      const rows = await claimWave(campaign.id, RESEND_BATCH_MAX);
      if (rows.length === 0) break;
      result.waves.push(rows[0].wave_no);
      await sendRows(rows);
    }
  }

  const pending = await countPending(campaign.id);
  let status: CampaignStatus = campaign.status === 'ready' ? 'sending' : campaign.status;
  if (pending.queued === 0 && pending.sending === 0) {
    // Condicional: una pausa/cancelación concurrente gana.
    const { data } = await getSupabase()
      .from('marketing_campaign')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', campaign.id)
      .in('status', ['ready', 'sending'])
      .select('status')
      .maybeSingle<{ status: CampaignStatus }>();
    if (data) status = data.status;
  }
  return { ...result, remaining: pending.queued, status };
}
