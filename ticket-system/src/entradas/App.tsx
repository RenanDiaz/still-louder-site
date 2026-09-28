import { useEffect, useMemo, useState } from 'react';
import {
  createOrder,
  getOrderStatus,
  getPresaleStatus,
  getYappyConfig,
  type CreateOrderResponse,
  type PresaleNumbers,
  type PresaleStatusResponse,
  type PublicEvent,
  type YappyConfigResponse
} from '../shared/api';
import {
  BAND_NAME,
  PAYMENT_METHODS,
  SOCIAL,
  TIER_LABELS,
  formatEventDay,
  formatEventTime,
  formatMoney,
  formatPriceLabel,
  priceBreakdown,
  type TierKey
} from '../shared/config';
import { Countdown } from './Countdown';
import { Teaser } from './Teaser';
import { YappyButton } from './YappyButton';

type Method = (typeof PAYMENT_METHODS)[number]['value'];

// Paths that mean "no slug": /entradas (and the root redirect) show the
// server's current event. Any other path is the event slug (/31-10,
// /when-we-were-young-3 via rewrite). ?evento=<slug> works on any path, so a
// brand-new event is reachable before it gets its own rewrite.
const NO_SLUG_PATHS = new Set(['', 'entradas', 'index', 'index.html', 'entradas.html']);

function resolveSlug(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('evento');
  if (fromQuery) return fromQuery.trim().toLowerCase();
  const last = window.location.pathname.split('/').filter(Boolean).pop() ?? '';
  const clean = last.replace(/\.html$/, '');
  return NO_SLUG_PATHS.has(clean) ? null : clean;
}

// A pending Yappy order survives a refresh (the Yappy modal's countdown dies
// with the page, but the IPN doesn't need the browser — restoring the
// confirmation lets polling pick the truth back up). Stored per event.
const pendingOrderKey = (slug: string) => `sl.pendingYappyOrder.${slug}`;

function restorePendingOrder(slug: string): CreateOrderResponse | null {
  try {
    const raw = sessionStorage.getItem(pendingOrderKey(slug));
    return raw ? (JSON.parse(raw) as CreateOrderResponse) : null;
  } catch {
    return null;
  }
}

/**
 * Loads the event (by path slug, or the current one) and picks the view from
 * its status: teaser → minimal teaser; everything else → the sale page, which
 * itself decides countdown / form / sold out / "ya pasó" from the event dates.
 */
export default function App() {
  const slug = useMemo(resolveSlug, []);
  const [data, setData] = useState<PresaleStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<'not_found' | 'network' | null>(null);

  useEffect(() => {
    getPresaleStatus(slug)
      .then(setData)
      .catch((err: Error & { status?: number }) => setLoadError(err.status === 404 ? 'not_found' : 'network'));
  }, [slug]);

  const event = data?.event ?? null;

  // Theme + view on <html>: theme.css / themes/*.css / teaser.css key off these.
  useEffect(() => {
    if (!event) return;
    const root = document.documentElement;
    root.dataset.theme = event.theme;
    root.dataset.view = event.status === 'teaser' ? 'teaser' : 'sale';
    if (event.status !== 'teaser') document.title = `${event.name} · ${BAND_NAME} en vivo`;
  }, [event]);

  if (loadError) return <LoadErrorNotice kind={loadError} />;
  if (!data || !event) return <div className="tk-page" aria-busy="true" />;
  if (event.status === 'teaser') return <Teaser event={event} />;
  return <Sale event={event} initialPresale={data.presale} />;
}

function LoadErrorNotice({ kind }: { kind: 'not_found' | 'network' }) {
  return (
    <div className="tk-page">
      <div className="tk-wrap">
        <div className="tk-closed-notice" role="status">
          <strong>{kind === 'not_found' ? '⚡ No encontramos este evento' : '⚡ No pudimos cargar la página'}</strong>
          <p>
            {kind === 'not_found' ? (
              <>
                Revisa el enlace o busca la fecha en nuestro Instagram{' '}
                <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
                  <b>{SOCIAL.instagramHandle}</b>
                </a>
                .
              </>
            ) : (
              'Revisa tu conexión y recarga la página.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function Sale({ event, initialPresale }: { event: PublicEvent; initialPresale: PresaleNumbers | null }) {
  const [presale, setPresale] = useState<PresaleNumbers | null>(initialPresale);
  const [yappyCfg, setYappyCfg] = useState<YappyConfigResponse | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // Presale is over once its date passes (independent of the async cupo check).
  // State (not a constant) so a server-side `presale_ended` rejection — e.g.
  // a buyer with a skewed clock — can flip it too.
  const [presaleEnded, setPresaleEnded] = useState(
    () => Date.now() >= new Date(event.presaleEnd).getTime()
  );
  // Sales open at event.presaleStart: until then the buy form stays hidden and
  // only the countdown + an "aún no disponible" notice show. State (not a
  // constant) so it flips on its own at the opening time without a redeploy.
  const presaleStartMs = new Date(event.presaleStart).getTime();
  const [salesOpen, setSalesOpen] = useState(() => Date.now() >= presaleStartMs);
  // El evento ya pasó: la venta cerró y la página queda como archivo. Estado
  // (no constante) para que un rechazo `sales_closed` del servidor —un cliente
  // con reloj atrasado— también lo active. El servidor es la autoridad.
  const [salesEnded, setSalesEnded] = useState(
    () => event.status === 'archived' || Date.now() >= new Date(event.salesEnd).getTime()
  );
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<Method>('cuantoapp');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<CreateOrderResponse | null>(() => restorePendingOrder(event.slug));

  // Flip salesOpen on its own when the opening time arrives (no redeploy
  // needed). setTimeout caps at ~24.8 days, so re-arm in chunks for far dates.
  const [rearm, setRearm] = useState(0);
  useEffect(() => {
    if (salesOpen) return;
    const remaining = presaleStartMs - Date.now();
    const id = setTimeout(
      () => (Date.now() >= presaleStartMs ? setSalesOpen(true) : setRearm((n) => n + 1)),
      Math.min(Math.max(remaining, 0), 2 ** 31 - 1)
    );
    return () => clearTimeout(id);
  }, [salesOpen, presaleStartMs, rearm]);

  // Cupo de preventa. Con la venta cerrada no hay contador que mostrar ni
  // formulario que alimentar: no consultamos nada ni dejamos el sondeo corriendo.
  // (La carga inicial ya vino con el evento; aquí solo el refresco.)
  const refreshPresale = () =>
    getPresaleStatus(event.slug)
      .then((r) => setPresale(r.presale))
      .catch(() => {});
  useEffect(() => {
    if (salesEnded) return;
    // Refresca el cupo periódicamente: el contador "quedan N" y el cierre por
    // agotado deben reflejar compras de otros compradores sin recargar la página.
    const timer = setInterval(refreshPresale, 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesEnded, event.slug]);

  // La config de Yappy se pide siempre: una orden pendiente restaurada de
  // sessionStorage necesita el CDN del botón incluso si la venta ya cerró.
  useEffect(() => {
    getYappyConfig()
      .then((cfg) => {
        setYappyCfg(cfg);
        // Yappy is the flagship method: preselect it when available.
        if (cfg.enabled) setMethod('yappy');
      })
      .catch(() => setYappyCfg({ enabled: false, cdnUrl: null }));
  }, []);

  // Persist pending Yappy confirmations across refreshes (see pendingOrderKey).
  useEffect(() => {
    try {
      if (confirmation && confirmation.payment.method === 'yappy') {
        sessionStorage.setItem(pendingOrderKey(event.slug), JSON.stringify(confirmation));
      } else {
        sessionStorage.removeItem(pendingOrderKey(event.slug));
      }
    } catch {
      // storage unavailable (private mode) — refresh just loses the view
    }
  }, [confirmation, event.slug]);

  const presaleSoldOut = presale?.soldOut ?? false;
  // Aforo total: al agotarse no se vende más en NINGUNA tarifa — el
  // formulario se reemplaza por el aviso de agotado. null = status aún no cargó.
  const eventSoldOut = presale?.eventSoldOut ?? false;
  const totalAvailable = presale?.totalAvailable ?? null;
  // Preventa can only be bought while its date is open AND cupo remains.
  const presaleAvailable = !presaleEnded && !presaleSoldOut;
  // The tier is never the buyer's choice: while presale is available everyone
  // pays the cheaper presale price; once it ends or sells out, general applies.
  const tier: TierKey = presaleAvailable ? 'preventa' : 'general';
  // El total que paga el comprador incluye el "Cargo por servicio" que absorbe
  // la comisión del método elegido. Estimación en cliente; el servidor manda.
  const unitPrice = event.tiers[tier];
  const tierLabel = TIER_LABELS[tier];
  const { netCents, feeCents, totalCents } = priceBreakdown(unitPrice, quantity, method);

  // No ofrecer más boletos de los que quedan (el servidor rechaza igual, pero
  // el selector no debe invitar a pedir 10 cuando quedan 3).
  const maxQuantity =
    totalAvailable !== null ? Math.max(1, Math.min(10, totalAvailable)) : 10;
  useEffect(() => {
    if (quantity > maxQuantity) setQuantity(maxQuantity);
  }, [quantity, maxQuantity]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await createOrder({
        event: event.slug,
        buyer_name: name,
        buyer_email: email,
        buyer_phone: phone || undefined,
        tier,
        quantity,
        payment_method: method
      });
      setConfirmation(result);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'sales_closed' || code === 'event_not_found') {
        // El servidor dice que el evento ya pasó (nuestro reloj iba atrasado):
        // el formulario se reemplaza por el aviso de cierre.
        setSalesEnded(true);
      } else if (code === 'sold_out') {
        // Aforo total agotado: se acabó la venta. Reflejarlo localmente al
        // instante (el formulario se reemplaza por el aviso de agotado) y dejar
        // que el refetch confirme.
        setPresale((p) => ({
          available: 0,
          capacity: p?.capacity ?? 0,
          stage2Active: p?.stage2Active ?? false,
          soldOut: true,
          totalAvailable: 0,
          eventSoldOut: true
        }));
        refreshPresale();
      } else if (code === 'presale_sold_out') {
        setError('La preventa se agotó. Ahora aplica el precio general — revisa el total antes de continuar.');
        // Flip availability locally right away (works even if the status fetch
        // failed earlier); the refetch then refines the real count.
        setPresale((p) => ({
          available: 0,
          capacity: p?.capacity ?? 0,
          stage2Active: p?.stage2Active ?? false,
          soldOut: true,
          totalAvailable: p?.totalAvailable ?? 0,
          eventSoldOut: p?.eventSoldOut ?? false
        }));
        refreshPresale();
      } else if (code === 'presale_ended') {
        setError('La preventa terminó. Ahora aplica el precio general — revisa el total antes de continuar.');
        setPresaleEnded(true);
      } else if (code === 'presale_available') {
        // The server knows better: presale is open again (freed cupo or our
        // clock was ahead). Flip back so the buyer pays the cheaper price.
        setError('¡La preventa está disponible! Aplica su precio — revisa el total antes de continuar.');
        setPresaleEnded(false);
        setPresale((p) => (p ? { ...p, available: Math.max(p.available, 1), soldOut: false } : p));
        refreshPresale();
      } else if (code === 'sales_not_open') {
        setError('La venta aún no abre. Revisa el contador y vuelve a intentarlo cuando llegue a cero.');
        setSalesOpen(false);
      } else if (code === 'invalid_email') {
        setError('Revisa el correo: parece inválido.');
      } else {
        setError('No pudimos crear tu orden. Inténtalo de nuevo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const availableMethods = PAYMENT_METHODS.filter(
    (m) => m.value !== 'yappy' || (yappyCfg?.enabled ?? false)
  );

  if (confirmation) {
    return (
      <Confirmation
        data={confirmation}
        event={event}
        yappyCdnUrl={yappyCfg?.cdnUrl ?? null}
        onReset={() => setConfirmation(null)}
      />
    );
  }

  return (
    <div className="tk-page">
      <Decorations />
      <div className="tk-wrap">
        {/* Hero: arte del flyer oficial sobre parche de papel inclinado. Sigue
            siendo el h1 de la página: el alt lleva el texto que antes era visible. */}
        <EventHero event={event} />

        <p className="tk-meta tk-reveal">
          {event.theme === 'wwwy3'
            ? salesEnded
              ? 'Fue una noche de covers de las bandas que nos inspiraron'
              : 'Una noche de covers de las bandas que nos inspiraron'
            : `${formatEventDay(event.startsAt)} · ${formatEventTime(event.startsAt)}${
                event.venue ? ` · ${event.venue}` : ''
              }`}
        </p>

        {/* Precios + fecha como stickers de collage */}
        <div className="tk-prices">
          <div
            className={`tk-badge tk-patch tk-patch--dark tk-reveal${
              presaleAvailable ? '' : ' tk-badge--soldout'
            }`}
            style={{ transform: 'rotate(-4deg)' }}
          >
            <small>BOLETOS</small>
            <span className="amt">{formatPriceLabel(event.tiers.preventa)}</span>
            <small>PREVENTA</small>
            {!presaleAvailable && (
              <span className="tk-badge__stamp" aria-label="Preventa agotada">
                Sold out
              </span>
            )}
          </div>
          <div className="tk-date tk-patch tk-reveal" style={{ transform: 'rotate(1.5deg)' }}>
            <span className="day">{shortDay(event.startsAt)}</span>
            <span className="venue">{event.venue ?? 'Panamá'} ⚡</span>
          </div>
          {/* Con la venta cerrada el sello también va en la tarifa general: nada
              en esta página debe sugerir que todavía se puede comprar. */}
          <div
            className={`tk-badge tk-patch tk-patch--dark tk-reveal${salesEnded ? ' tk-badge--soldout' : ''}`}
            style={{ transform: 'rotate(4deg)' }}
          >
            <small>BOLETOS</small>
            <span className="amt">{formatPriceLabel(event.tiers.general)}</span>
            <small>GENERAL</small>
            {salesEnded && (
              <span className="tk-badge__stamp" aria-label="Venta cerrada">
                Sold out
              </span>
            )}
          </div>
        </div>

        {/* Countdown + urgencia. Con el evento pasado no hay nada que contar:
            el countdown desaparece en vez de quedarse clavado en ceros. */}
        {!salesEnded && (
          <div className="tk-reveal">
            <Countdown presaleStart={event.presaleStart} startsAt={event.startsAt} />
          </div>
        )}
        {/* Antes de que abra la preventa el formulario se oculta: el comprador
            solo ve el countdown y un aviso de que aún no puede comprar. Con el
            aforo total agotado tampoco hay formulario: solo el aviso de agotado.
            Y con el evento ya pasado la página queda como archivo del show. */}
        {salesEnded ? (
          <EventOverNotice event={event} />
        ) : !salesOpen ? (
          <PresaleNotOpenNotice event={event} />
        ) : eventSoldOut ? (
          <SoldOutNotice />
        ) : (
          <>
            <PresaleIndicator presale={presale} presaleEnded={presaleEnded} />

            {/* Formulario: temático pero LEGIBLE (sin filtro rasgado en inputs) */}
            <form className="tk-form tk-reveal" onSubmit={handleSubmit}>
              <h2 className="tk-form__title">Compra tus entradas</h2>

              {/* La tarifa no se elige: se aplica sola la mejor disponible. */}
              <span className="tk-label" id="tier-label">
                Tipo de entrada
              </span>
              <p className="tk-tier" aria-labelledby="tier-label" aria-live="polite">
                <span className="tk-tier__name">{tierLabel}</span>
                <strong className="tk-tier__price">{formatPriceLabel(unitPrice)}</strong>
              </p>
              <p className="tk-hint">
                {presaleAvailable
                  ? 'Te aplicamos automáticamente el precio de preventa mientras esté disponible.'
                  : presaleEnded
                    ? 'La preventa terminó: las entradas se venden al precio general.'
                    : 'La preventa se agotó: las entradas se venden al precio general.'}
              </p>

              <label htmlFor="quantity">Cantidad</label>
              <select
                id="quantity"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              >
                {Array.from({ length: maxQuantity }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <label htmlFor="name">Nombre completo</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />

              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <p className="tk-hint">Aquí enviaremos tu entrada con el código QR.</p>

              <label htmlFor="phone">{method === 'yappy' ? 'Teléfono (Yappy)' : 'Teléfono (opcional)'}</label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required={method === 'yappy'}
              />
              {method === 'yappy' && (
                <p className="tk-hint">El número panameño asociado a tu cuenta de Yappy.</p>
              )}

              <label htmlFor="method">Método de pago</label>
              <select id="method" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                {availableMethods.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              {error && (
                <div className="tk-alert tk-alert--error" role="alert">
                  {error}
                </div>
              )}

              <div className="tk-price-summary" aria-live="polite">
                <p className="tk-price-summary__row">
                  <span className="tk-price-summary__tier">{tierLabel}</span>
                  <span className="tk-price-summary__calc">
                    {formatPriceLabel(unitPrice)} × {quantity}
                  </span>
                  <span className="tk-price-summary__amount">{formatMoney(netCents)}</span>
                </p>
                {feeCents > 0 && (
                  <p className="tk-price-summary__row tk-price-summary__row--fee">
                    <span className="tk-price-summary__tier">Cargo por servicio</span>
                    <span className="tk-price-summary__amount">{formatMoney(feeCents)}</span>
                  </p>
                )}
                <p className="tk-price-summary__row tk-price-summary__row--total">
                  <span className="tk-price-summary__tier">Total</span>
                  <strong className="tk-price-summary__total">{formatMoney(totalCents)}</strong>
                </p>
              </div>

              <p className="tk-hint">
                Todas las compras son finales: <b>no hacemos reembolsos</b>. Una vez comprada, la
                entrada es tuya — úsala, regálala, transfiérela o revéndela.
              </p>

              <button type="submit" className="tk-cta" disabled={submitting}>
                {submitting ? 'Procesando…' : `Comprar — ${formatMoney(totalCents)} ⚡`}
              </button>
            </form>
          </>
        )}

        {/* Confianza: canales oficiales */}
        <p className="tk-trust">
          {salesEnded ? (
            <>
              Canales oficiales de la banda:{' '}
              <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
                <b>{SOCIAL.instagramHandle}</b>
              </a>
              . Ahí anunciamos la próxima fecha.
            </>
          ) : (
            <>
              Compra directamente con la banda. Canales oficiales:{' '}
              <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
                <b>{SOCIAL.instagramHandle}</b>
              </a>
              . No vendemos por intermediarios.
            </>
          )}
          <br />
          ¿Dudas?{' '}
          <a href="/ayuda">
            <b>Ayuda y preguntas frecuentes</b>
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/** Estrellas y rayos decorativos (puramente ornamentales). */
function Decorations() {
  return (
    <>
      <div className="tk-deco" style={{ top: 70, left: -6, transform: 'rotate(-15deg)' }} aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" focusable="false">
          <path style={{ fill: 'var(--pink)' }} d="M12 2l2.6 6.6L22 9.3l-5 4.7L18.5 22 12 18l-6.5 4L7 14 2 9.3l7.4-.7z" />
        </svg>
      </div>
      <div className="tk-deco" style={{ top: 168, right: -4, transform: 'rotate(12deg)' }} aria-hidden="true">
        <svg width="32" height="38" viewBox="0 0 12 22" focusable="false">
          <path style={{ fill: 'var(--ink)' }} d="M7 0L0 12h4l-2 10 8-13H6z" />
        </svg>
      </div>
    </>
  );
}

/**
 * Antes de que abra la preventa el formulario de compra permanece oculto; este
 * aviso le dice al comprador que aún no puede comprar y lo remite al countdown.
 * Se reemplaza solo por el formulario cuando llega la hora de apertura.
 */
function PresaleNotOpenNotice({ event }: { event: PublicEvent }) {
  return (
    <div className="tk-closed-notice tk-reveal" role="status">
      <strong>⚡ La preventa aún no abre</strong>
      <p>
        Las entradas estarán disponibles el{' '}
        <b>
          {formatEventDay(event.presaleStart)} a las {formatEventTime(event.presaleStart)}
        </b>
        . El contador de arriba marca cuánto falta — vuelve cuando llegue a cero para comprar la tuya.
      </p>
    </div>
  );
}

/**
 * Hero: WWWY3 keeps its flyer art (theme `wwwy3`); any other event gets its
 * name as a typographic title on the paper patch until it has art of its own.
 * Either way it's the page's h1.
 */
function EventHero({ event }: { event: PublicEvent }) {
  if (event.theme === 'wwwy3') {
    return (
      <div className="tk-title-block tk-reveal">
        <div className="tk-patch tk-title-patch tk-title-patch--art">
          <h1 className="tk-title-art">
            <img src="/wwwy3-title.webp" alt={`${BAND_NAME} presenta: ${event.name}`} width={984} height={543} />
          </h1>
        </div>
      </div>
    );
  }
  return (
    <div className="tk-title-block tk-reveal">
      <div className="tk-patch tk-title-patch">
        <h1 className="tk-title">
          <span className="l1">{event.name}</span>
        </h1>
        <div className="tk-byline">{event.tagline ?? `by ${BAND_NAME}`}</div>
      </div>
    </div>
  );
}

/** "31 OCT" (hora Panamá) para el sticker de fecha. */
function shortDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('es-PA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Panama'
  }).formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace('.', '');
  return `${day} ${month}`.toUpperCase();
}

/**
 * Post-evento: la venta cerró y la página queda como archivo del show. Este
 * aviso reemplaza al formulario y al countdown; el resto de la página (arte,
 * precios con sello, enlace a /ayuda) sigue en pie para quien llegue buscando
 * su compra. Se activa por fecha (event.salesEnd) o al archivar el evento.
 */
function EventOverNotice({ event }: { event: PublicEvent }) {
  return (
    <div className="tk-closed-notice tk-reveal" role="status">
      <strong>⚡ El show ya pasó</strong>
      <p>
        {event.name} fue el{' '}
        <b>
          {formatEventDay(event.startsAt)}
          {event.venue ? ` en ${event.venue}` : ''}
        </b>{' '}
        — gracias a todos los que llegaron. Ya no vendemos entradas para este evento.
      </p>
      <p>
        La próxima fecha la anunciamos primero en Instagram{' '}
        <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
          <b>{SOCIAL.instagramHandle}</b>
        </a>
        . ¿Tienes una consulta sobre tu compra? Revisa la{' '}
        <a href="/ayuda">
          <b>ayuda</b>
        </a>
        .
      </p>
    </div>
  );
}

/**
 * Con el aforo total agotado (todos los boletos comprometidos) la venta cierra en
 * TODAS las tarifas: este aviso reemplaza al formulario de compra completo.
 */
function SoldOutNotice() {
  return (
    <div className="tk-closed-notice tk-reveal" role="status">
      <strong>⚡ Boletos agotados</strong>
      <p>
        Vendimos <b>todas</b> las entradas disponibles — ¡gracias por el apoyo! Si tienes una orden
        pendiente de pago, tu cupo sigue reservado hasta que expire.
      </p>
    </div>
  );
}

function PresaleIndicator({
  presale,
  presaleEnded
}: {
  presale: PresaleNumbers | null;
  presaleEnded: boolean;
}) {
  // Contador de aforo total: cuántos boletos quedan a la venta sumando todas
  // las tarifas. El caso "0 / agotado" no llega aquí: reemplaza el formulario
  // entero con <SoldOutNotice />.
  const total = presale?.totalAvailable ?? null;
  const totalLine =
    total !== null && total > 0 ? (
      <p className="tk-stock">
        ★ {total === 1 ? 'queda' : 'quedan'} <b>{total}</b>{' '}
        {total === 1 ? 'boleto disponible' : 'boletos disponibles'} ★
      </p>
    ) : null;

  // Date-based end takes priority: once the window closes there's no presale to
  // count, regardless of the cupo the status endpoint reports.
  if (presaleEnded) {
    return (
      <>
        {totalLine}
        <p className="tk-stock tk-stock--soldout">
          preventa finalizada — entrada general al precio del día ★
        </p>
      </>
    );
  }
  if (!presale) return null;
  if (presale.soldOut) {
    return (
      <>
        {totalLine}
        <p className="tk-stock tk-stock--soldout">
          preventa agotada — entrada general ★
        </p>
      </>
    );
  }
  // Preventa activa: el contador total manda. Si el cupo de preventa es menor
  // que los boletos restantes, aclarar cuántos conservan su precio.
  return (
    <>
      {totalLine}
      {total !== null && presale.available < total && (
        <p className="tk-stock">
          los próximos <b>{presale.available}</b> al precio de preventa ★
        </p>
      )}
    </>
  );
}

function Confirmation({
  data,
  event,
  yappyCdnUrl,
  onReset
}: {
  data: CreateOrderResponse;
  event: PublicEvent;
  yappyCdnUrl: string | null;
  onReset: () => void;
}) {
  const isYappy = data.payment.method === 'yappy';
  return (
    <div className="tk-page">
      <Decorations />
      <div className="tk-wrap">
        <p className="tk-kicker tk-reveal">★ ¡nos vemos {event.venue ? `en ${event.venue}` : 'en el show'}! ♥ ★</p>

        <div className="tk-title-block tk-reveal">
          <div className="tk-patch tk-title-patch">
            <h1 className="tk-title">
              <span className="l1">¡ORDEN</span>
              <span className="l2">CREADA!</span>
            </h1>
            <div className="tk-byline">
              {event.shortName} · by {BAND_NAME}
            </div>
          </div>
        </div>

        <div className="tk-form tk-success tk-reveal">
          <p style={{ fontSize: 16 }}>
            Reservamos {data.quantity} {data.quantity === 1 ? 'entrada' : 'entradas'} por un total de{' '}
            <strong>{data.payment.amount}</strong>.
          </p>
          {data.breakdown.feeCents > 0 && (
            <p className="tk-success__breakdown" style={{ fontSize: 14, margin: '0 0 8px' }}>
              Entradas {formatMoney(data.breakdown.netCents)} + Cargo por servicio{' '}
              {formatMoney(data.breakdown.feeCents)}
            </p>
          )}

          {isYappy ? (
            <YappyCheckout data={data} cdnUrl={yappyCdnUrl} onReset={onReset} />
          ) : (
            <div className="tk-alert tk-alert--success" style={{ textAlign: 'left' }}>
              <strong>Siguiente paso — {data.payment.method === 'cash' ? 'Efectivo' : 'Pago'}</strong>
              <p style={{ margin: 0 }}>{data.payment.note}</p>
              {data.payment.link && (
                <p style={{ margin: '8px 0 0' }}>
                  <a href={data.payment.link} target="_blank" rel="noopener noreferrer">
                    Ir a pagar →
                  </a>
                </p>
              )}
            </div>
          )}

          <p className="tk-success__order">
            Tu entrada con el código QR llegará por correo en cuanto confirmemos el pago. Guarda tu
            número de orden: <code>{data.orderId}</code>
          </p>

          <button className="tk-btn-secondary" onClick={onReset}>
            Comprar otra entrada
          </button>
        </div>

        <p className="tk-trust">
          ¿Dudas? Escríbenos por nuestros canales oficiales:{' '}
          <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
            <b>{SOCIAL.instagramHandle}</b>
          </a>{' '}
          o revisa la{' '}
          <a href="/ayuda">
            <b>ayuda y preguntas frecuentes</b>
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * Yappy checkout block: renders the brand button and polls the order status
 * until the server-side IPN confirms the payment. eventSuccess only switches
 * the copy to "esperando confirmación" — `paid` is whatever the backend says,
 * so a refresh mid-payment (which kills the Yappy modal) loses nothing.
 */
function YappyCheckout({
  data,
  cdnUrl,
  onReset
}: {
  data: CreateOrderResponse;
  cdnUrl: string | null;
  onReset: () => void;
}) {
  const [phase, setPhase] = useState<'pay' | 'waiting' | 'paid' | 'expired'>('pay');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (phase === 'paid' || phase === 'expired') return;
    const poll = async () => {
      try {
        const status = await getOrderStatus(data.orderId);
        if (status.status === 'paid') {
          setPhase('paid');
        } else if (status.status === 'cancelled') {
          setPhase('expired');
        } else if (
          status.reservationExpiresAt &&
          new Date(status.reservationExpiresAt) <= new Date()
        ) {
          setPhase('expired');
        }
      } catch {
        // transient network error — next tick retries
      }
    };
    poll();
    const timer = setInterval(poll, 4000);
    return () => clearInterval(timer);
  }, [phase, data.orderId]);

  if (phase === 'paid') {
    return (
      <div className="tk-alert tk-alert--success" style={{ textAlign: 'left' }}>
        <strong>¡Pago confirmado! ⚡</strong>
        <p style={{ margin: 0 }}>
          Tu {data.quantity === 1 ? 'entrada va' : 'entradas van'} en camino a tu correo con el
          código QR. Revisa también la carpeta de spam.
        </p>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div className="tk-alert tk-alert--error" role="alert" style={{ textAlign: 'left' }}>
        <strong>Tu reserva expiró</strong>
        <p style={{ margin: 0 }}>
          El pago no se confirmó a tiempo y el cupo fue liberado. Crea una nueva orden para volver a
          intentarlo.
        </p>
        <p style={{ margin: '8px 0 0' }}>
          <button className="tk-btn-secondary" onClick={onReset}>
            Crear nueva orden
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="tk-alert tk-alert--success" style={{ textAlign: 'left' }}>
      <strong>Siguiente paso — Paga con Yappy</strong>
      <p style={{ margin: '0 0 8px' }}>{data.payment.note}</p>
      {cdnUrl ? (
        <YappyButton
          orderId={data.orderId}
          cdnUrl={cdnUrl}
          onPaymentSent={() => {
            setMessage('');
            setPhase('waiting');
          }}
          onError={(msg) => setMessage(msg)}
        />
      ) : (
        <p style={{ margin: 0 }}>Cargando el botón de Yappy…</p>
      )}
      {phase === 'waiting' && (
        <p style={{ margin: '8px 0 0' }}>
          Esperando la confirmación de Yappy… esta página se actualiza sola al confirmarse el pago.
        </p>
      )}
      {message && (
        <p style={{ margin: '8px 0 0' }} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
