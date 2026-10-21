import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createMarketingCampaign,
  deleteMarketingCampaign,
  duplicateMarketingCampaign,
  fetchMarketingContacts,
  freezeMarketingCampaign,
  getMarketingCampaign,
  listMarketingCampaigns,
  marketingCampaignAction,
  previewMarketingCampaign,
  requeueMarketingOrphans,
  sendMarketingCampaign,
  tagMarketingContacts,
  testMarketingCampaign,
  updateMarketingCampaign,
  type AdminEvent,
  type Audience,
  type CampaignDetail,
  type CampaignInput,
  type CampaignPreview,
  type CampaignStatus,
  type CampaignTotals,
  type ContactStatus,
  type MarketingCampaign,
  type MarketingContactsResponse
} from '../shared/api';

// =============================================================================
// Pestaña Campañas: correos de promoción (spec docs/features/campanas-promocion.md).
// =============================================================================
// No depende del evento elegido (como Eventos). Tres secciones: Contactos (aquí
// se etiqueta a los 'allegado'), Campañas (lista) y el Editor de la campaña
// abierta, con el flujo Prueba → Congelar → Enviar. El servidor es quien aplica
// D12, el tope de frecuencia, las bajas y "un correo por contacto"; este panel
// solo muestra, confirma y vuelve a llamar.
// =============================================================================

const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  subscribed: 'Suscrito',
  unsubscribed: 'De baja',
  bounced: 'Rebotó',
  complained: 'Queja'
};

const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Borrador',
  ready: 'Congelada',
  sending: 'Enviando',
  paused: 'Pausada',
  completed: 'Completada',
  cancelled: 'Cancelada'
};

// Mismo umbral que el servidor (WAVE_BRAKE_RATE en api/_lib/marketing.ts).
const BRAKE_RATE = 0.05;

const ERROR_MESSAGES: Record<string, string> = {
  invalid_slug: 'Slug inválido: solo minúsculas, números y guiones (p. ej. a-las-10).',
  slug_taken: 'Ya existe una campaña con ese slug.',
  invalid_subject: 'El asunto debe tener entre 1 y 120 caracteres.',
  invalid_preheader: 'El preheader admite hasta 140 caracteres.',
  invalid_body: 'El cuerpo es demasiado largo.',
  invalid_image_url: 'La imagen debe ser una URL https://.',
  invalid_cta_url: 'El enlace del botón debe ser una URL https://.',
  invalid_cta_label: 'El texto del botón admite hasta 40 caracteres.',
  incomplete_cta: 'El botón necesita texto Y enlace (o ninguno de los dos).',
  invalid_wave_size: 'El tamaño de ola debe ser un entero entre 1 y 1000.',
  empty_selection: 'Elige al menos una etiqueta, un evento o un correo.',
  invalid_audience_emails: 'Hay correos inválidos en la selección manual.',
  invalid_audience_tags: 'Etiquetas inválidas: solo minúsculas, números y guiones.',
  not_draft: 'La campaña ya está congelada: para corregirla, cancélala y duplícala.',
  test_required: 'Falta el envío de prueba (o el contenido cambió después de la última prueba).',
  empty_audience: 'Nadie cumple esa audiencia: no hay a quién enviar.',
  not_sendable: 'La campaña no está lista para enviar.',
  invalid_transition: 'Ese cambio de estado no está permitido ahora.',
  invalid_email: 'Correo de prueba inválido.',
  invalid_emails: 'Selecciona al menos un contacto.',
  invalid_tags: 'Etiqueta inválida: solo minúsculas, números y guiones (p. ej. allegado).',
  send_failed: 'Resend rechazó el envío.',
  send_interrupted:
    'Resend no respondió. Parte del lote quedó «enviando»: revisa en Resend antes de reintentar (botón de huérfanos en 10 min).'
};

function errorText(err: unknown, fallback = 'Algo salió mal.'): string {
  const e = err as Error & { code?: string; detail?: string };
  const base = ERROR_MESSAGES[e.code ?? ''] ?? fallback;
  return e.detail ? `${base} (${e.detail})` : base;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Panama'
  });
}

const checkboxStyle = { width: 'auto', marginBottom: 0 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' };

export function CampanasTab({ password, events }: { password: string; events: AdminEvent[] }) {
  // Lo marcado en Contactos sirve de "selección manual" en el editor.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const bumpList = useCallback(() => setListVersion((v) => v + 1), []);

  return (
    <>
      <ContactsSection password={password} events={events} selected={selected} setSelected={setSelected} />
      <CampaignsSection password={password} version={listVersion} openId={openId} onOpen={setOpenId} />
      {openId && (
        <CampaignEditor
          key={openId}
          password={password}
          id={openId}
          events={events}
          selectedEmails={[...selected]}
          onChanged={bumpList}
          onOpen={setOpenId}
        />
      )}
    </>
  );
}

// --- 1. Contactos ----------------------------------------------------------------

function ContactsSection({
  password,
  events,
  selected,
  setSelected
}: {
  password: string;
  events: AdminEvent[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  const [filters, setFilters] = useState({ q: '', status: '', tag: '', event: '' });
  const [data, setData] = useState<MarketingContactsResponse | null>(null);
  const [tagInput, setTagInput] = useState('allegado');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const eventName = useMemo(() => new Map(events.map((e) => [e.id, e.short_name])), [events]);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await fetchMarketingContacts(password, filters));
    } catch (err) {
      setError(errorText(err, 'No se pudieron cargar los contactos.'));
    }
  }, [password, filters]);

  useEffect(() => {
    load();
    // Solo al abrir y al cambiar los filtros de selección (el buscador va por submit).
  }, [password, filters.status, filters.tag, filters.event]);

  const visible = data?.contacts ?? [];
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.email));

  function toggle(email: string) {
    const next = new Set(selected);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    setSelected(next);
  }

  function toggleAllVisible() {
    const next = new Set(selected);
    for (const c of visible) {
      if (allVisibleSelected) next.delete(c.email);
      else next.add(c.email);
    }
    setSelected(next);
  }

  async function applyTag(mode: 'add' | 'remove') {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || selected.size === 0) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { updated } = await tagMarketingContacts(password, {
        emails: [...selected],
        ...(mode === 'add' ? { add_tags: [tag] } : { remove_tags: [tag] })
      });
      setMessage(`✓ «${tag}» ${mode === 'add' ? 'agregada a' : 'quitada de'} ${updated} contacto(s).`);
      await load();
    } catch (err) {
      setError(errorText(err, 'No se pudo etiquetar.'));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>Contactos</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Correos únicos de órdenes pagadas de cualquier evento (incluye cortesías y regalos). Se sincronizan al abrir
        esta pestaña. Marca a los <b>allegado</b> aquí: son la muestra de la primera ola y, mientras el tema legal
        siga abierto, los únicos compradores sin opt-in que entran por defecto.
      </p>
      {data && (
        <p style={{ fontSize: 14 }}>
          {data.total} contactos · {data.counts.subscribed ?? 0} suscritos · {data.counts.unsubscribed ?? 0} de baja ·{' '}
          {data.counts.bounced ?? 0} rebotados · {data.counts.complained ?? 0} quejas
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 12px' }}
      >
        <div>
          <label htmlFor="mc-q">Buscar</label>
          <input id="mc-q" value={filters.q} onChange={set('q')} placeholder="correo o nombre (Enter)" />
        </div>
        <div>
          <label htmlFor="mc-status">Estado</label>
          <select id="mc-status" value={filters.status} onChange={set('status')}>
            <option value="">Todos</option>
            {Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mc-tag">Etiqueta</label>
          <select id="mc-tag" value={filters.tag} onChange={set('tag')}>
            <option value="">Todas</option>
            {(data?.tags ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mc-event">Evento</label>
          <select id="mc-event" value={filters.event} onChange={set('event')}>
            <option value="">Todos</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.short_name}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>{selected.size} seleccionado(s)</span>
        <input
          aria-label="Etiqueta"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          style={{ width: 160, marginBottom: 0 }}
        />
        <button type="button" className="small" disabled={busy || selected.size === 0} onClick={() => applyTag('add')}>
          Agregar etiqueta
        </button>
        <button
          type="button"
          className="small secondary"
          disabled={busy || selected.size === 0}
          onClick={() => applyTag('remove')}
        >
          Quitar etiqueta
        </button>
        {selected.size > 0 && (
          <button type="button" className="small secondary" onClick={() => setSelected(new Set())}>
            Limpiar selección
          </button>
        )}
      </div>
      {message && <div className="alert alert--success">{message}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  style={checkboxStyle}
                  aria-label="Seleccionar todos los visibles"
                />
              </th>
              <th>Contacto</th>
              <th>Consentimiento</th>
              <th>Estado</th>
              <th>Etiquetas</th>
              <th>Eventos</th>
              <th>Última campaña</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.email}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(c.email)}
                    onChange={() => toggle(c.email)}
                    style={checkboxStyle}
                    aria-label={`Seleccionar ${c.email}`}
                  />
                </td>
                <td>
                  {c.email}
                  {c.name && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {c.name}
                    </div>
                  )}
                </td>
                <td>{c.consent_source === 'checkout_opt_in' ? 'Opt-in' : 'Previo (sin opt-in)'}</td>
                <td>
                  <span className="badge">{CONTACT_STATUS_LABELS[c.status]}</span>
                </td>
                <td>{c.tags.join(', ') || '—'}</td>
                <td style={{ fontSize: 13 }}>{c.event_ids.map((id) => eventName.get(id) ?? '?').join(', ') || '—'}</td>
                <td style={{ fontSize: 13 }}>{fmtDate(c.last_campaign_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && visible.length === 0 && <p className="muted">Ningún contacto con esos filtros.</p>}
      </div>
    </div>
  );
}

// --- 2. Campañas ---------------------------------------------------------------------

function CampaignsSection({
  password,
  version,
  openId,
  onOpen
}: {
  password: string;
  version: number;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<(MarketingCampaign & { totals: CampaignTotals })[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listMarketingCampaigns(password)
      .then((r) => setCampaigns(r.campaigns))
      .catch((err) => setError(errorText(err, 'No se pudieron cargar las campañas.')));
  }, [password, version]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { campaign } = await createMarketingCampaign(password, { slug, subject });
      setCampaigns((list) => [{ ...campaign, totals: emptyTotals() }, ...(list ?? [])]);
      setCreating(false);
      setSlug('');
      setSubject('');
      onOpen(campaign.id);
    } catch (err) {
      setError(errorText(err, 'No se pudo crear la campaña.'));
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Campañas</h2>
        <button type="button" onClick={() => setCreating((v) => !v)}>
          + Nueva campaña
        </button>
      </div>
      {creating && (
        <form onSubmit={create} style={{ ...gridStyle, marginTop: 12 }}>
          <div>
            <label htmlFor="nc-slug">Slug (va en utm_campaign)</label>
            <input
              id="nc-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="a-las-10"
            />
          </div>
          <div>
            <label htmlFor="nc-subject">Asunto</label>
            <input id="nc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={120} />
          </div>
          <div style={{ alignSelf: 'end', marginBottom: 16 }}>
            <button type="submit">Crear borrador</button>
          </div>
        </form>
      )}
      {error && <div className="alert alert--error">{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Estado</th>
              <th>Enviados</th>
              <th>Fallidos</th>
              <th>Omitidos</th>
              <th>En cola</th>
              <th>Bajas</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(campaigns ?? []).map((c) => (
              <tr key={c.id} style={c.id === openId ? { outline: '2px solid var(--accent)' } : undefined}>
                <td>
                  <b>{c.subject}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {c.slug} · {c.delivery === 'waves' ? `olas de ${c.wave_size}` : 'inmediata'}
                  </div>
                </td>
                <td>
                  <span className="badge">{CAMPAIGN_STATUS_LABELS[c.status]}</span>
                </td>
                <td>{c.totals.sent}</td>
                <td>{c.totals.failed}</td>
                <td>{c.totals.skipped}</td>
                <td>{c.totals.queued + c.totals.sending}</td>
                <td>{c.totals.unsubscribed}</td>
                <td>
                  <button type="button" className="small secondary" onClick={() => onOpen(c.id)}>
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {campaigns && campaigns.length === 0 && <p className="muted">Todavía no hay campañas.</p>}
      </div>
    </div>
  );
}

function emptyTotals(): CampaignTotals {
  return {
    recipients: 0,
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    skipped_by_reason: { unsubscribed: 0, bounced: 0, complained: 0, frequency_cap: 0, cancelled: 0 },
    unsubscribed: 0,
    waves: 0
  };
}

// --- 3. Editor -----------------------------------------------------------------------

// Los tres atajos de la UI sobre los dos ejes de D5 (audiencia × entrega).
type Mode = 'todos' | 'escalonado' | 'seleccionados';

interface FormState {
  subject: string;
  preheader: string;
  body_md: string;
  image_url: string;
  cta_label: string;
  cta_url: string;
  mode: Mode;
  wave_size: string;
  tags: string; // separadas por coma
  event_ids: string[];
  emails: string; // uno por línea
  exclude_event_ids: string[];
  include_legacy: boolean;
}

function formFromCampaign(c: MarketingCampaign): FormState {
  const a = c.audience;
  return {
    subject: c.subject,
    preheader: c.preheader,
    body_md: c.body_md,
    image_url: c.image_url ?? '',
    cta_label: c.cta_label ?? '',
    cta_url: c.cta_url ?? '',
    mode: a.kind !== 'all' ? 'seleccionados' : c.delivery === 'waves' ? 'escalonado' : 'todos',
    wave_size: String(c.wave_size ?? 20),
    tags: (a.tags ?? []).join(', '),
    event_ids: a.event_ids ?? [],
    emails: (a.emails ?? []).join('\n'),
    exclude_event_ids: a.exclude_event_ids ?? [],
    include_legacy: a.include_legacy === true
  };
}

function audienceFromForm(f: FormState): Audience {
  const common = { exclude_event_ids: f.exclude_event_ids, include_legacy: f.include_legacy };
  if (f.mode !== 'seleccionados') return { kind: 'all', ...common };
  const tags = f.tags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const emails = f.emails
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const kind = emails.length ? 'manual' : tags.length ? 'tags' : 'events';
  return { kind, tags, event_ids: f.event_ids, emails, ...common };
}

function inputFromForm(f: FormState): CampaignInput {
  return {
    subject: f.subject,
    preheader: f.preheader,
    body_md: f.body_md,
    image_url: f.image_url.trim() || null,
    cta_label: f.cta_label.trim() || null,
    cta_url: f.cta_url.trim() || null,
    audience: audienceFromForm(f),
    delivery: f.mode === 'escalonado' ? 'waves' : 'immediate',
    ...(f.mode === 'escalonado' ? { wave_size: Number(f.wave_size) } : {})
  };
}

function CampaignEditor({
  password,
  id,
  events,
  selectedEmails,
  onChanged,
  onOpen
}: {
  password: string;
  id: string;
  events: AdminEvent[];
  selectedEmails: string[];
  onChanged: () => void;
  onOpen: (id: string | null) => void;
}) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const d = await getMarketingCampaign(password, id);
    setDetail(d);
    setForm(formFromCampaign(d.campaign));
    return d;
  }, [password, id]);

  const refreshPreview = useCallback(
    async (audience?: Audience) => {
      try {
        setPreview(await previewMarketingCampaign(password, id, audience));
      } catch (err) {
        setError(errorText(err, 'No se pudo generar la vista previa.'));
      }
    },
    [password, id]
  );

  useEffect(() => {
    reload()
      .then(() => refreshPreview())
      .catch((err) => setError(errorText(err, 'No se pudo abrir la campaña.')));
  }, [reload, refreshPreview]);

  if (!detail || !form) {
    return <div className="card">{error ? <div className="alert alert--error">{error}</div> : 'Cargando…'}</div>;
  }

  const c = detail.campaign;
  const isDraft = c.status === 'draft';
  const dirty = JSON.stringify(inputFromForm(form)) !== JSON.stringify(inputFromForm(formFromCampaign(c)));
  const testValid = c.test_sent_at !== null && c.test_sent_at >= c.content_updated_at;
  const t = detail.totals;

  const set =
    (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => f && { ...f, [key]: e.target.value });
  const toggleIn = (key: 'event_ids' | 'exclude_event_ids', eventId: string) =>
    setForm(
      (f) =>
        f && {
          ...f,
          [key]: f[key].includes(eventId) ? f[key].filter((x) => x !== eventId) : [...f[key], eventId]
        }
    );

  async function run(action: () => Promise<string | void>, fallback: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const ok = await action();
      if (ok) setMessage(ok);
      await reload();
      onChanged();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const input = inputFromForm(form);
      await updateMarketingCampaign(password, id, input);
      await refreshPreview();
      return '✓ Guardado.';
    }, 'No se pudo guardar.');

  const sendTest = () =>
    run(async () => {
      await testMarketingCampaign(password, id, testEmail);
      return `✓ Prueba enviada a ${testEmail}. Revisa asunto, enlaces, el pie de baja y cómo se ve en el móvil.`;
    }, 'No se pudo enviar la prueba.');

  const freeze = () => {
    const n = preview?.counts?.eligible ?? 0;
    const capped = preview?.counts?.frequency_cap ?? 0;
    if (
      !window.confirm(
        `¿Congelar la audiencia?\n\nRecibirían ${n} contacto(s)${capped ? ` (+${capped} hoy dentro del tope de frecuencia, se omitirán si siguen así al enviar)` : ''}.\nDespués, contenido y audiencia quedan de solo lectura.`
      )
    )
      return;
    run(async () => {
      const { recipients } = await freezeMarketingCampaign(password, id);
      return `✓ Congelada con ${recipients} destinatario(s).`;
    }, 'No se pudo congelar.');
  };

  const send = () => {
    const waves = c.delivery === 'waves';
    const queued = t.queued;
    const size = waves ? Math.min(c.wave_size ?? 20, queued) : queued;
    let confirmRate = false;
    if (waves && detail.last_wave?.over_brake) {
      const pct = (detail.last_wave.rate * 100).toFixed(1);
      if (
        !window.confirm(
          `⚠️ La ola ${detail.last_wave.wave} tuvo ${pct} % de bajas + fallidos (umbral ${BRAKE_RATE * 100} %).\n\n¿Seguro que quieres enviar la siguiente ola?`
        )
      )
        return;
      confirmRate = true;
    }
    if (
      !window.confirm(
        waves
          ? `¿Enviar la ola ${t.waves + 1} a ${size} destinatario(s)?\n\nQuedan ${queued} en cola. Quien se haya dado de baja o esté dentro del tope de frecuencia se omite.`
          : `¿Enviar la campaña a ${queued} destinatario(s)?\n\nQuien se haya dado de baja o esté dentro del tope de frecuencia se omite.`
      )
    )
      return;
    run(async () => {
      let sent = 0;
      let failed = 0;
      // Inmediato: el servidor corta antes de su presupuesto y devuelve
      // { remaining }; volvemos a llamar hasta vaciar la cola.
      for (let i = 0; i < 100; i++) {
        const r = await sendMarketingCampaign(password, id, confirmRate ? { confirm_rate: true } : {});
        sent += r.sent;
        failed += r.failed;
        setMessage(`Enviando… ${sent} enviados, ${failed} fallidos, ${r.remaining} en cola.`);
        if (waves || r.remaining === 0 || r.status !== 'sending' || r.sent + r.failed === 0) break;
      }
      return `✓ ${sent} enviado(s), ${failed} fallido(s).`;
    }, 'No se pudo enviar.');
  };

  const action = (name: 'pause' | 'resume' | 'cancel', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    run(async () => {
      await marketingCampaignAction(password, id, name);
    }, 'No se pudo cambiar el estado.');
  };

  const requeue = () => {
    if (
      !window.confirm(
        `Hay ${detail.orphans} destinatario(s) «enviando» hace más de 10 min sin id de Resend.\n\nAntes de devolverlos a la cola, confirma en el dashboard de Resend que NO salieron (si salieron, se duplicarían). ¿Devolverlos a la cola?`
      )
    )
      return;
    run(async () => {
      const { requeued } = await requeueMarketingOrphans(password, id);
      return `✓ ${requeued} devuelto(s) a la cola.`;
    }, 'No se pudo reintentar.');
  };

  const duplicate = () =>
    run(async () => {
      const { campaign } = await duplicateMarketingCampaign(password, id);
      onOpen(campaign.id);
      return `✓ Duplicada como ${campaign.slug}.`;
    }, 'No se pudo duplicar.');

  const remove = () => {
    if (!window.confirm(`¿Borrar el borrador «${c.slug}»?`)) return;
    setBusy(true);
    deleteMarketingCampaign(password, id)
      .then(() => {
        onChanged();
        onOpen(null);
      })
      .catch((err) => setError(errorText(err, 'No se pudo borrar.')))
      .finally(() => setBusy(false));
  };

  const counts = preview?.counts;
  const skipped = counts ? counts.unsubscribed + counts.bounced + counts.complained + counts.frequency_cap : 0;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>
          {c.slug} <span className="badge">{CAMPAIGN_STATUS_LABELS[c.status]}</span>
        </h2>
        <button type="button" className="small secondary" onClick={() => onOpen(null)}>
          Cerrar
        </button>
      </div>
      {!isDraft && (
        <p className="muted" style={{ fontSize: 13 }}>
          Congelada el {fmtDate(c.frozen_at)}: contenido y audiencia son de solo lectura. Para corregirla, cancélala y
          duplícala.
        </p>
      )}
      {message && <div className="alert alert--success">{message}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        <fieldset disabled={!isDraft || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <h3 style={{ marginTop: 12 }}>Contenido</h3>
          <label htmlFor="ce-subject">Asunto</label>
          <input id="ce-subject" value={form.subject} onChange={set('subject')} maxLength={120} required />
          <label htmlFor="ce-preheader">Preheader (texto junto al asunto en la bandeja)</label>
          <input id="ce-preheader" value={form.preheader} onChange={set('preheader')} maxLength={140} />
          <label htmlFor="ce-body">Cuerpo (Markdown: **negrita**, *cursiva*, [texto](https://…), - listas, ## título)</label>
          <textarea id="ce-body" value={form.body_md} onChange={set('body_md')} rows={12} />
          <label htmlFor="ce-image">Imagen (URL https, opcional)</label>
          <input id="ce-image" type="url" value={form.image_url} onChange={set('image_url')} />
          <div style={gridStyle}>
            <div>
              <label htmlFor="ce-cta-label">Botón: texto</label>
              <input id="ce-cta-label" value={form.cta_label} onChange={set('cta_label')} maxLength={40} />
            </div>
            <div>
              <label htmlFor="ce-cta-url">Botón: enlace (https)</label>
              <input id="ce-cta-url" type="url" value={form.cta_url} onChange={set('cta_url')} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Los enlaces a still-louder.com y entradas.still-louder.com llevan UTM automáticamente. Sin pixel ni
            reescritura de enlaces. El saludo («Hola, Ana:») y el pie de baja los pone la plantilla.
          </p>

          <h3>Audiencia y entrega</h3>
          {(['seleccionados', 'escalonado', 'todos'] as Mode[]).map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
              <input
                type="radio"
                name="ce-mode"
                checked={form.mode === m}
                onChange={() => setForm((f) => f && { ...f, mode: m })}
                style={checkboxStyle}
              />
              {m === 'seleccionados' && 'Seleccionados — por etiqueta(s), evento y/o a mano'}
              {m === 'escalonado' && 'Escalonado — todos los elegibles, en olas (allegados primero)'}
              {m === 'todos' && 'Todos — todos los elegibles de una vez'}
            </label>
          ))}
          <div style={{ marginTop: 12 }}>
            {form.mode === 'seleccionados' && (
              <>
                <label htmlFor="ce-tags">Etiquetas (separadas por coma)</label>
                <input id="ce-tags" value={form.tags} onChange={set('tags')} placeholder="allegado" />
                <label>Compraron para</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 16 }}>
                  {events.map((e) => (
                    <label key={e.id} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={form.event_ids.includes(e.id)}
                        onChange={() => toggleIn('event_ids', e.id)}
                        style={checkboxStyle}
                      />
                      {e.short_name}
                    </label>
                  ))}
                </div>
                <label htmlFor="ce-emails">Correos a mano (uno por línea)</label>
                <textarea id="ce-emails" value={form.emails} onChange={set('emails')} rows={4} />
                <button
                  type="button"
                  className="small secondary"
                  disabled={selectedEmails.length === 0}
                  onClick={() => setForm((f) => f && { ...f, emails: [...new Set(selectedEmails)].join('\n') })}
                  style={{ marginBottom: 16 }}
                >
                  Usar los {selectedEmails.length} seleccionados en Contactos
                </button>
              </>
            )}
            {form.mode === 'escalonado' && (
              <>
                <label htmlFor="ce-wave">Tamaño de ola</label>
                <input id="ce-wave" type="number" min={1} max={1000} value={form.wave_size} onChange={set('wave_size')} />
              </>
            )}
            <label>Excluir a quienes compraron para (opcional)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 16 }}>
              {events.map((e) => (
                <label key={e.id} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={form.exclude_event_ids.includes(e.id)}
                    onChange={() => toggleIn('exclude_event_ids', e.id)}
                    style={checkboxStyle}
                  />
                  {e.short_name}
                </label>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={form.include_legacy}
                onChange={(e) => setForm((f) => f && { ...f, include_legacy: e.target.checked })}
                style={checkboxStyle}
              />
              Incluir compradores sin opt-in
            </label>
            {form.include_legacy && (
              <div className="alert alert--error" style={{ marginTop: 8 }}>
                ⚠️ Compradores previos que nunca marcaron la casilla de noticias. Mientras no se confirme la base legal
                (Ley 81, P1 del spec), deja esto apagado salvo decisión explícita.
              </div>
            )}
          </div>

          {isDraft && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={save} disabled={busy || !dirty}>
                Guardar
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => refreshPreview(audienceFromForm(form))}
                disabled={busy}
              >
                Recalcular audiencia
              </button>
              <button type="button" className="secondary" onClick={remove} disabled={busy}>
                Borrar borrador
              </button>
            </div>
          )}
        </fieldset>

        <div style={{ minWidth: 0 }}>
          <h3 style={{ marginTop: 12 }}>Vista previa</h3>
          {counts && (
            <p style={{ fontSize: 14 }}>
              Recibirán <b>{counts.eligible}</b> · Se omiten {skipped} ({counts.unsubscribed} de baja,{' '}
              {counts.frequency_cap} por frecuencia
              {counts.bounced + counts.complained > 0 ? `, ${counts.bounced + counts.complained} rebote/queja` : ''})
              {counts.no_consent > 0 && (
                <>
                  {' '}
                  · <b>{counts.no_consent}</b> sin opt-in fuera (D12)
                </>
              )}
              {dirty && <span className="muted"> · sin guardar: pulsa «Recalcular audiencia»</span>}
            </p>
          )}
          {preview && (
            <iframe
              title="Vista previa del correo"
              srcDoc={preview.html}
              sandbox=""
              style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}
            />
          )}
          <p className="muted" style={{ fontSize: 12 }}>
            Vista previa con un nombre de ejemplo. Imágenes de otros dominios no se ven aquí (CSP del panel): revísalas
            en la prueba.
          </p>
        </div>
      </div>

      <h3>Prueba → Congelar → Enviar</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="email"
          aria-label="Correo de prueba"
          placeholder="tu@correo.com"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          style={{ width: 240, marginBottom: 0 }}
        />
        <button type="button" className="secondary" onClick={sendTest} disabled={busy || !testEmail || dirty}>
          1 · Enviar prueba
        </button>
        {isDraft && (
          <button type="button" onClick={freeze} disabled={busy || dirty || !testValid}>
            2 · Congelar audiencia
          </button>
        )}
        {(c.status === 'ready' || c.status === 'sending') && t.queued > 0 && (
          <button type="button" onClick={send} disabled={busy}>
            3 · {c.delivery === 'waves' ? `Enviar ${t.waves > 0 ? 'siguiente ' : ''}ola` : 'Enviar'}
            {c.delivery === 'waves' && detail.last_wave?.over_brake
              ? ` ⚠️ ${(detail.last_wave.rate * 100).toFixed(1)} %`
              : ''}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        {dirty
          ? 'Guarda los cambios antes de probar.'
          : c.test_sent_at
            ? testValid
              ? `Última prueba: ${fmtDate(c.test_sent_at)}.`
              : 'El contenido cambió después de la última prueba: envía otra antes de congelar.'
            : 'Sin prueba todavía: es obligatoria antes de congelar.'}
      </p>

      {!isDraft && (
        <>
          <h3>Métricas</h3>
          <div className="stat-grid">
            <Stat label="Destinatarios" value={t.recipients} />
            <Stat label="Enviados" value={t.sent} />
            <Stat label="Fallidos" value={t.failed} />
            <Stat label="En cola" value={t.queued} />
            <Stat label="Omitidos" value={t.skipped} />
            <Stat label="Bajas atribuidas" value={t.unsubscribed} />
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Omitidos: {t.skipped_by_reason.unsubscribed} de baja · {t.skipped_by_reason.frequency_cap} por frecuencia (
            {detail.frequency_cap_days} días) · {t.skipped_by_reason.bounced + t.skipped_by_reason.complained} rebote/queja
            · {t.skipped_by_reason.cancelled} por cancelación
          </p>
          {detail.waves.some((w) => w.wave !== null) && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Ola</th>
                    <th>Salió</th>
                    <th>Enviados</th>
                    <th>Fallidos</th>
                    <th>Omitidos</th>
                    <th>Bajas</th>
                    <th>Bajas + fallidos</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.waves
                    .filter((w) => w.wave !== null)
                    .map((w) => {
                      const tried = w.sent + w.failed;
                      const rate = tried ? (w.unsubscribed + w.failed) / tried : 0;
                      const skippedW =
                        w.skipped_unsubscribed +
                        w.skipped_bounced +
                        w.skipped_complained +
                        w.skipped_frequency_cap +
                        w.skipped_cancelled;
                      return (
                        <tr key={w.wave}>
                          <td>{w.wave}</td>
                          <td>{fmtDate(w.first_sent_at)}</td>
                          <td>{w.sent}</td>
                          <td>{w.failed}</td>
                          <td>{skippedW}</td>
                          <td>{w.unsubscribed}</td>
                          <td style={rate >= BRAKE_RATE ? { color: 'var(--red)', fontWeight: 700 } : undefined}>
                            {(rate * 100).toFixed(1)} %
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {(c.status === 'ready' || c.status === 'sending') && (
              <button type="button" className="secondary" onClick={() => action('pause')} disabled={busy}>
                Pausar
              </button>
            )}
            {c.status === 'paused' && (
              <button type="button" className="secondary" onClick={() => action('resume')} disabled={busy}>
                Reanudar
              </button>
            )}
            {['ready', 'sending', 'paused'].includes(c.status) && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  action('cancel', `¿Cancelar «${c.slug}»? Los ${t.queued} en cola no recibirán el correo.`)
                }
                disabled={busy}
              >
                Cancelar campaña
              </button>
            )}
            {detail.orphans > 0 && (
              <button type="button" className="secondary" onClick={requeue} disabled={busy}>
                Reintentar {detail.orphans} huérfano(s)
              </button>
            )}
            <button type="button" className="secondary" onClick={duplicate} disabled={busy}>
              Duplicar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}
