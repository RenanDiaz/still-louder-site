import { useState } from 'react';
import {
  createEvent,
  setEventStatus,
  updateEvent,
  type AdminEvent,
  type EventInput,
  type EventStatus,
  type StockDisplay
} from '../shared/api';

// =============================================================================
// Pestaña Eventos: donde nace cada show (spec docs/features/multi-evento.md).
// =============================================================================
// Un evento se crea en `draft` y avanza draft → teaser → on_sale → archived
// (on_sale → teaser = pausar). Las fechas se editan en hora de Panamá (UTC-5
// fijo, sin horario de verano) y se guardan como timestamptz. El código (prefijo
// del QR) y el slug (URL pública) se bloquean en el servidor apenas el evento
// tiene entradas emitidas.
// =============================================================================

const STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Borrador',
  teaser: 'Teaser',
  on_sale: 'En venta',
  archived: 'Archivado'
};

// Mirror of the server's allowed transitions (api/_lib/events.ts); the server
// re-validates, this only decides which buttons to show.
const NEXT_STATUS: Record<EventStatus, { to: EventStatus; label: string; confirm: string }[]> = {
  draft: [{ to: 'teaser', label: 'Publicar teaser', confirm: 'Su página mostrará el teaser (solo la fecha).' }],
  teaser: [
    {
      to: 'on_sale',
      label: 'Abrir venta',
      confirm: 'El formulario de compra se abre en presale_start (antes, cuenta regresiva).'
    }
  ],
  on_sale: [
    { to: 'teaser', label: 'Pausar (volver a teaser)', confirm: 'Se deja de vender hasta volver a abrir.' },
    { to: 'archived', label: 'Archivar', confirm: 'Es definitivo: no se podrá editar ni volver a vender.' }
  ],
  archived: []
};

const THEMES = [
  { value: 'mono', label: 'Mono (negro + hueso)' },
  { value: 'wwwy3', label: 'WWWY3 (morado/rosa)' },
  { value: 'halloween', label: 'Halloween (noche + rojo sangre)' }
];

// Contador "quedan N" de la página pública (spec docs/features/contador-boletos.md).
const STOCK_DISPLAY_OPTIONS: { value: StockDisplay; label: string }[] = [
  { value: 'always', label: 'Siempre' },
  { value: 'never', label: 'Nunca' },
  { value: 'threshold', label: 'Solo cuando queden pocos' }
];

const ERROR_MESSAGES: Record<string, string> = {
  invalid_slug: 'Slug inválido: solo minúsculas, números y guiones (p. ej. halloween-party).',
  invalid_code: 'Código inválido: 3 a 8 letras mayúsculas o números (p. ej. SL3110).',
  invalid_name: 'El nombre debe tener entre 2 y 120 caracteres.',
  invalid_short_name: 'El nombre corto debe tener entre 2 y 24 caracteres.',
  invalid_date_order: 'Fechas fuera de orden: inicio preventa ≤ fin preventa ≤ cierre de venta ≤ fin del evento.',
  missing_tiers: 'Faltan los precios de preventa y general.',
  missing_prices: 'Para abrir la venta, preventa y general necesitan un precio mayor a $0.',
  slug_or_code_taken: 'Ya existe un evento con ese slug o código.',
  identity_locked: 'Este evento ya tiene entradas emitidas: el código y el slug no se pueden cambiar.',
  event_archived: 'Un evento archivado no se puede editar.',
  invalid_transition: 'Ese cambio de estado no está permitido.',
  status_changed: 'Otro admin cambió el estado mientras tanto. Recarga e inténtalo de nuevo.',
  invalid_og_image_url: 'La imagen OG debe ser una URL https://.',
  missing_stock_display_threshold: 'Indica a partir de cuántos boletos restantes se muestra el contador.',
  invalid_stock_display_threshold: 'El umbral del contador debe ser un número entero mayor a 0.'
};

function errorText(err: unknown): string {
  const code = (err as Error & { code?: string }).code ?? '';
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (code.startsWith('invalid_') || code.startsWith('missing_')) return `Campo inválido: ${code}`;
  return 'No se pudo guardar el evento.';
}

// Panama is UTC-5 all year: convert between timestamptz and <input type=datetime-local>.
const PANAMA_OFFSET_MS = 5 * 60 * 60 * 1000;
function toPanamaInput(iso: string): string {
  return new Date(new Date(iso).getTime() - PANAMA_OFFSET_MS).toISOString().slice(0, 16);
}
function fromPanamaInput(value: string): string {
  return `${value}:00-05:00`;
}

function fmtPanama(iso: string): string {
  return new Date(iso).toLocaleString('es-PA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Panama'
  });
}

interface FormState {
  name: string;
  short_name: string;
  tagline: string;
  slug: string;
  code: string;
  venue: string;
  venue_address: string;
  starts_at: string;
  presale_start: string;
  presale_end: string;
  sales_end: string;
  event_end: string;
  presale_stage1_cap: string;
  presale_stage2_cap: string;
  total_capacity: string;
  price_preventa: string;
  price_general: string;
  theme: string;
  og_image_url: string;
  stock_display: StockDisplay;
  stock_display_threshold: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  short_name: '',
  tagline: '',
  slug: '',
  code: '',
  venue: '',
  venue_address: '',
  starts_at: '',
  presale_start: '',
  presale_end: '',
  sales_end: '',
  event_end: '',
  presale_stage1_cap: '75',
  presale_stage2_cap: '25',
  total_capacity: '230',
  price_preventa: '',
  price_general: '',
  theme: 'mono',
  og_image_url: '',
  stock_display: 'always',
  stock_display_threshold: ''
};

function formFromEvent(e: AdminEvent): FormState {
  return {
    name: e.name,
    short_name: e.short_name,
    tagline: e.tagline ?? '',
    slug: e.slug,
    code: e.code,
    venue: e.venue ?? '',
    venue_address: e.venue_address ?? '',
    starts_at: toPanamaInput(e.starts_at),
    presale_start: toPanamaInput(e.presale_start),
    presale_end: toPanamaInput(e.presale_end),
    sales_end: toPanamaInput(e.sales_end),
    event_end: toPanamaInput(e.event_end),
    presale_stage1_cap: String(e.presale_stage1_cap),
    presale_stage2_cap: String(e.presale_stage2_cap),
    total_capacity: String(e.total_capacity),
    price_preventa: (e.tiers.preventa / 100).toFixed(2),
    price_general: (e.tiers.general / 100).toFixed(2),
    theme: e.theme,
    og_image_url: e.og_image_url ?? '',
    stock_display: e.stock_display,
    stock_display_threshold: e.stock_display_threshold === null ? '' : String(e.stock_display_threshold)
  };
}

function inputFromForm(f: FormState): EventInput {
  const cents = (v: string) => Math.round(Number(v) * 100);
  return {
    name: f.name,
    short_name: f.short_name,
    tagline: f.tagline,
    slug: f.slug,
    code: f.code.toUpperCase(),
    venue: f.venue,
    venue_address: f.venue_address,
    starts_at: fromPanamaInput(f.starts_at),
    presale_start: fromPanamaInput(f.presale_start),
    presale_end: fromPanamaInput(f.presale_end),
    sales_end: fromPanamaInput(f.sales_end),
    event_end: fromPanamaInput(f.event_end),
    presale_stage1_cap: Number(f.presale_stage1_cap),
    presale_stage2_cap: Number(f.presale_stage2_cap),
    total_capacity: Number(f.total_capacity),
    theme: f.theme,
    og_image_url: f.og_image_url,
    stock_display: f.stock_display,
    // Se guarda aunque el modo no sea 'threshold', para no perderlo al alternar.
    stock_display_threshold: f.stock_display_threshold === '' ? null : Number(f.stock_display_threshold),
    tiers: { preventa: cents(f.price_preventa), general: cents(f.price_general) }
  };
}

export function EventosTab({
  password,
  events,
  onChanged,
  onSelect
}: {
  password: string;
  events: AdminEvent[];
  onChanged: () => Promise<void>;
  onSelect: (id: string) => void;
}) {
  // null = no form open; 'new' = creating; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function transition(e: AdminEvent, to: EventStatus, confirmText: string) {
    if (!window.confirm(`¿${STATUS_LABELS[e.status]} → ${STATUS_LABELS[to]} para «${e.name}»?\n\n${confirmText}`)) return;
    setError('');
    setMessage('');
    try {
      await setEventStatus(password, e.id, to);
      setMessage(`✓ «${e.name}» ahora está en ${STATUS_LABELS[to]}.`);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const editingEvent = editing && editing !== 'new' ? events.find((e) => e.id === editing) : undefined;

  return (
    <>
      {message && <div className="alert alert--success">{message}</div>}
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Eventos</h2>
          <button
            type="button"
            onClick={() => {
              setEditing('new');
              setMessage('');
              setError('');
            }}
          >
            + Nuevo evento
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Fecha (Panamá)</th>
                <th>Estado</th>
                <th>Precios</th>
                <th>Vendidas / aforo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <b>{e.name}</b>
                    <div className="muted" style={{ fontSize: 12 }}>
                      /{e.slug} · QR {e.code}
                    </div>
                  </td>
                  <td>{fmtPanama(e.starts_at)}</td>
                  <td>
                    <span className="badge">{STATUS_LABELS[e.status]}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    ${(e.tiers.preventa / 100).toFixed(2)} / ${(e.tiers.general / 100).toFixed(2)}
                  </td>
                  <td>
                    {e.paidTickets ?? 0} / {e.total_capacity}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button type="button" className="secondary" onClick={() => onSelect(e.id)}>
                        Ver panel
                      </button>
                      {e.status !== 'archived' && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setEditing(e.id);
                            setMessage('');
                            setError('');
                          }}
                        >
                          Editar
                        </button>
                      )}
                      {NEXT_STATUS[e.status].map((t) => (
                        <button key={t.to} type="button" onClick={() => transition(e, t.to, t.confirm)}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          La página pública de cada evento es <code>/entradas?evento=&lt;slug&gt;</code> (o su ruta propia, como{' '}
          <code>/halloween-party</code>). <code>/entradas</code> a secas muestra el evento en venta más próximo.
        </p>
      </div>

      {editing && (
        <EventForm
          key={editing}
          password={password}
          event={editingEvent}
          onCancel={() => setEditing(null)}
          onSaved={async (saved, created) => {
            setEditing(null);
            setError('');
            setMessage(created ? `✓ Evento «${saved.name}» creado en borrador.` : `✓ Evento «${saved.name}» guardado.`);
            await onChanged();
            if (created) onSelect(saved.id);
          }}
        />
      )}
    </>
  );
}

function EventForm({
  password,
  event,
  onCancel,
  onSaved
}: {
  password: string;
  event?: AdminEvent;
  onCancel: () => void;
  onSaved: (saved: AdminEvent, created: boolean) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => (event ? formFromEvent(event) : EMPTY_FORM));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const identityLocked = (event?.paidTickets ?? 0) > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = inputFromForm(form);
      const { event: saved } = event ? await updateEvent(password, event.id, input) : await createEvent(password, input);
      await onSaved(saved, !event);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof FormState, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`ev-${key}`}>{label}</label>
      <input id={`ev-${key}`} value={form[key]} onChange={set(key)} {...props} />
    </div>
  );

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0 }}>{event ? `Editar «${event.name}»` : 'Nuevo evento'}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        {field('name', 'Nombre', { required: true, minLength: 2 })}
        {field('short_name', 'Nombre corto (correo, títulos)', { required: true, minLength: 2, maxLength: 24 })}
        {field('tagline', 'Invitados / subtítulo (opcional)', { placeholder: 'ft. Banda A & Banda B' })}
        {field('slug', 'Slug (URL)', {
          required: true,
          pattern: '[a-z0-9]+(-[a-z0-9]+)*',
          disabled: identityLocked,
          placeholder: 'halloween-party'
        })}
        {field('code', 'Código del QR', {
          required: true,
          pattern: '[A-Za-z0-9]{3,8}',
          disabled: identityLocked,
          placeholder: 'SL3110'
        })}
        {field('venue', 'Lugar')}
        {field('venue_address', 'Dirección')}
      </div>
      {identityLocked && (
        <p className="muted" style={{ fontSize: 13 }}>
          Slug y código bloqueados: el evento ya tiene entradas emitidas.
        </p>
      )}

      <h3>Fechas (hora de Panamá)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        {field('starts_at', 'Inicio del show', { type: 'datetime-local', required: true })}
        {field('presale_start', 'Abre la venta', { type: 'datetime-local', required: true })}
        {field('presale_end', 'Fin de preventa (desde aquí, solo general)', { type: 'datetime-local', required: true })}
        {field('sales_end', 'Cierre de venta', { type: 'datetime-local', required: true })}
        {field('event_end', 'Fin del evento (la puerta deja de validar)', {
          type: 'datetime-local',
          required: true
        })}
      </div>

      <h3>Precios y cupos</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 16px' }}>
        {field('price_preventa', 'Preventa ($)', { type: 'number', min: 0, step: '0.01', required: true })}
        {field('price_general', 'General ($)', { type: 'number', min: 0, step: '0.01', required: true })}
        {field('presale_stage1_cap', 'Cupo preventa etapa 1', { type: 'number', min: 0, step: 1, required: true })}
        {field('presale_stage2_cap', 'Cupo preventa etapa 2', { type: 'number', min: 0, step: 1, required: true })}
        {field('total_capacity', 'Aforo total', { type: 'number', min: 1, step: 1, required: true })}
      </div>

      <h3>Contador público de boletos</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        <div>
          <label htmlFor="ev-stock_display">Mostrar «quedan N boletos»</label>
          <select id="ev-stock_display" value={form.stock_display} onChange={set('stock_display')}>
            {STOCK_DISPLAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {field('stock_display_threshold', 'Mostrar cuando queden ≤', {
          type: 'number',
          min: 1,
          step: 1,
          disabled: form.stock_display !== 'threshold',
          required: form.stock_display === 'threshold'
        })}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Aplica al total y al cupo de preventa («los próximos N al precio de preventa»). Oculto, el número no sale del
        servidor. Este panel siempre muestra los números reales.
      </p>

      <h3>Apariencia</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        <div>
          <label htmlFor="ev-theme">Tema</label>
          <select id="ev-theme" value={form.theme} onChange={set('theme')}>
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {field('og_image_url', 'Imagen OG / Wallet (https, opcional)', { type: 'url' })}
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : event ? 'Guardar cambios' : 'Crear en borrador'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
