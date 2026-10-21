import { useEffect, useState } from 'react';
import { confirmUnsubscribe, getUnsubscribeStatus } from '../shared/api';
import { BAND_NAME, SOCIAL } from '../shared/config';

// Baja de las campañas de promoción (/baja?t=…, docs/features/campanas-promocion.md).
// Abrir la página NO da de baja: los escáneres de enlaces de los clientes de
// correo abren cada link. Solo el botón (POST) lo hace. El one-click de Gmail /
// Apple Mail va directo al endpoint y no pasa por aquí.

type View =
  | { kind: 'loading' }
  | { kind: 'confirm'; email: string }
  | { kind: 'done' }
  | { kind: 'already'; email: string }
  | { kind: 'invalid' }
  | { kind: 'error' };

function readToken(): string {
  return new URLSearchParams(window.location.search).get('t') ?? '';
}

export default function App() {
  const [token] = useState(readToken);
  const [view, setView] = useState<View>(token ? { kind: 'loading' } : { kind: 'invalid' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!token) return;
    getUnsubscribeStatus(token)
      .then((res) =>
        setView(
          res.status === 'subscribed'
            ? { kind: 'confirm', email: res.email_masked }
            : { kind: 'already', email: res.email_masked }
        )
      )
      .catch((err: Error & { status?: number }) => setView(err.status === 400 ? { kind: 'invalid' } : { kind: 'error' }));
  }, [token]);

  async function handleUnsubscribe() {
    setSubmitting(true);
    setSubmitError('');
    try {
      await confirmUnsubscribe(token);
      setView({ kind: 'done' });
    } catch (err) {
      if ((err as Error & { status?: number }).status === 400) setView({ kind: 'invalid' });
      else setSubmitError('No pudimos procesar tu baja. Inténtalo de nuevo en un momento.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tk-page">
      <div className="tk-wrap">
        <div className="tk-title-block tk-reveal">
          <div className="tk-patch tk-title-patch">
            <h1 className="tk-title">
              <span className="l1">{view.kind === 'done' ? '¡LISTO!' : 'DARTE'}</span>
              <span className="l2">DE BAJA</span>
            </h1>
            <div className="tk-byline">noticias de {BAND_NAME}</div>
          </div>
        </div>

        <div className="tk-form tk-reveal">
          {view.kind === 'loading' && <p style={{ textAlign: 'center', margin: 0 }}>Cargando…</p>}

          {view.kind === 'confirm' && (
            <>
              <p style={{ fontSize: 16, margin: '0 0 12px' }}>
                Vas a dejar de recibir noticias de {BAND_NAME} (música y shows) en <b>{view.email}</b>.
              </p>
              <p className="tk-hint">
                Tus entradas y comprobantes de compra te siguen llegando normal: esto solo afecta las
                promociones.
              </p>
              {submitError && (
                <div className="tk-alert tk-alert--error" role="alert">
                  {submitError}
                </div>
              )}
              <button type="button" className="tk-cta" onClick={handleUnsubscribe} disabled={submitting}>
                {submitting ? 'Procesando…' : 'Darme de baja'}
              </button>
            </>
          )}

          {view.kind === 'done' && (
            <div className="tk-alert tk-alert--success" role="status">
              <strong>No te escribiremos más promociones.</strong>
              <p style={{ margin: '8px 0 0' }}>Tus entradas y comprobantes siguen llegando normal.</p>
            </div>
          )}

          {view.kind === 'already' && (
            <div className="tk-alert tk-alert--success" role="status">
              <strong>Ya estabas de baja.</strong>
              <p style={{ margin: '8px 0 0' }}>
                {view.email} no recibe promociones de {BAND_NAME}. Tus entradas y comprobantes siguen
                llegando normal.
              </p>
            </div>
          )}

          {view.kind === 'invalid' && (
            <>
              <p style={{ fontSize: 16, textAlign: 'center', margin: 0 }}>
                Este enlace de baja no es válido o está incompleto.
              </p>
              <p className="tk-hint" style={{ textAlign: 'center' }}>
                Usa el enlace «date de baja aquí» del último correo que te enviamos, o escríbenos.
              </p>
            </>
          )}

          {view.kind === 'error' && (
            <p style={{ fontSize: 16, textAlign: 'center', margin: 0 }}>
              No pudimos cargar esta página. Recarga en un momento.
            </p>
          )}
        </div>

        <p className="tk-trust">
          ¿Dudas? Escríbenos por nuestros canales oficiales:{' '}
          <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
            <b>{SOCIAL.instagramHandle}</b>
          </a>
          .
        </p>
      </div>
    </div>
  );
}
