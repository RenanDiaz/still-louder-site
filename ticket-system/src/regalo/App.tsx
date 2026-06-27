import { useEffect, useState } from 'react';
import { claimGift, fetchGiftCampaign } from '../shared/api';
import { EVENT, SOCIAL } from '../shared/config';

// Hidden gift-claim surface, reached only via /regalo/<token> (the QR target).
// The token is the campaign secret; it lives in the URL path so no PII ever
// touches a query string. An unknown/invalid token yields a neutral
// "not found" screen — the existence of campaigns is never revealed.

// Pull the token from /regalo/<token>. Tolerant of a trailing slash.
function tokenFromPath(): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // ['regalo', '<token>']
  return parts.length >= 2 && parts[0] === 'regalo' ? decodeURIComponent(parts[1]) : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type View =
  | { kind: 'loading' }
  | { kind: 'notfound' } // neutral: bad token OR closed/exhausted on arrival
  | { kind: 'soldout' } // campaign reached N (friendly #N+1 copy)
  | { kind: 'form' }
  | { kind: 'claimed' }
  | { kind: 'already' }; // this email already claimed

export default function App() {
  const [token] = useState(tokenFromPath);
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setView({ kind: 'notfound' });
      return;
    }
    fetchGiftCampaign(token)
      .then((res) => {
        if (res.status === 'active') setView({ kind: 'form' });
        else if (res.status === 'exhausted') setView({ kind: 'soldout' });
        else setView({ kind: 'notfound' }); // 'closed' → neutral
      })
      .catch(() => setView({ kind: 'notfound' }));
  }, [token]);

  switch (view.kind) {
    case 'loading':
      return <Shell>{null}</Shell>;
    case 'notfound':
      return <NotFound />;
    case 'soldout':
      return <SoldOut />;
    case 'claimed':
      return <Claimed />;
    case 'already':
      return <AlreadyClaimed />;
    case 'form':
      return (
        <ClaimForm
          token={token}
          onClaimed={() => setView({ kind: 'claimed' })}
          onSoldOut={() => setView({ kind: 'soldout' })}
          onAlready={() => setView({ kind: 'already' })}
          onGone={() => setView({ kind: 'notfound' })}
        />
      );
  }
}

function ClaimForm({
  token,
  onClaimed,
  onSoldOut,
  onAlready,
  onGone
}: {
  token: string;
  onClaimed: () => void;
  onSoldOut: () => void;
  onAlready: () => void;
  onGone: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) {
      setError('Escribe tu nombre completo.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('Revisa el correo: parece inválido.');
      return;
    }
    setSubmitting(true);
    try {
      await claimGift({
        token,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined
      });
      onClaimed();
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'exhausted' || code === 'closed') onSoldOut();
      else if (code === 'already_claimed') onAlready();
      else if (code === 'not_found') onGone();
      else if (code === 'invalid_email') setError('Revisa el correo: parece inválido.');
      else if (code === 'invalid_name') setError('Escribe tu nombre completo.');
      else if (code === 'rate_limited')
        setError('Demasiados intentos. Espera un momento y vuelve a probar.');
      else setError('No pudimos procesar tu regalo. Inténtalo de nuevo.');
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <p className="tk-kicker tk-reveal">★ regalo secreto ★</p>
      <div className="tk-title-block tk-reveal">
        <div className="tk-patch tk-title-patch">
          <h1 className="tk-title">
            <span className="l1">¡ENTRADA</span>
            <span className="l2">DE REGALO!</span>
          </h1>
          <div className="tk-byline">
            {EVENT.shortName} · by {EVENT.band}
          </div>
        </div>
      </div>

      <p className="tk-meta tk-reveal">
        Encontraste el QR secreto 🤘 Las primeras personas en completar este formulario
        se ganan una entrada para <b>{EVENT.name}</b> el 1 de agosto en {EVENT.venue}.
      </p>

      <form className="tk-form tk-reveal" onSubmit={handleSubmit}>
        <h2 className="tk-form__title">Reclama tu regalo</h2>

        <label htmlFor="name">Nombre completo</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          autoComplete="name"
        />

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

        <label htmlFor="phone">Teléfono (opcional)</label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />

        {error && (
          <div className="tk-alert tk-alert--error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="tk-cta" disabled={submitting}>
          {submitting ? 'Procesando…' : 'Reclamar mi entrada ⚡'}
        </button>
      </form>

      <Trust />
    </Shell>
  );
}

function Claimed() {
  return (
    <Shell>
      <p className="tk-kicker tk-reveal">★ ¡nos vemos en {EVENT.venue}! ♥ ★</p>
      <div className="tk-title-block tk-reveal">
        <div className="tk-patch tk-title-patch">
          <h1 className="tk-title">
            <span className="l1">¡REGALO</span>
            <span className="l2">RECLAMADO!</span>
          </h1>
          <div className="tk-byline">
            {EVENT.shortName} · by {EVENT.band}
          </div>
        </div>
      </div>
      <div className="tk-form tk-success tk-reveal">
        <p style={{ fontSize: 16 }}>
          ¡Felicidades! 🎁 Tu entrada de regalo ya va en camino a tu correo con el código QR.
        </p>
        <p className="tk-hint">
          Revisa tu bandeja de entrada (y la carpeta de spam). Guarda el correo: ese QR es
          tu entrada para la puerta.
        </p>
      </div>
      <Trust />
    </Shell>
  );
}

function AlreadyClaimed() {
  return (
    <Shell>
      <div className="tk-title-block tk-reveal">
        <div className="tk-patch tk-title-patch">
          <h1 className="tk-title">
            <span className="l1">YA TIENES</span>
            <span className="l2">TU REGALO</span>
          </h1>
        </div>
      </div>
      <div className="tk-form tk-reveal">
        <div className="tk-alert tk-alert--success" role="status">
          <strong>Este correo ya reclamó una entrada de regalo.</strong>
          <p style={{ margin: '8px 0 0' }}>
            Revisa tu bandeja de entrada (y la carpeta de spam) — ahí está tu QR. Cada
            persona puede reclamar una sola vez.
          </p>
        </div>
      </div>
      <Trust />
    </Shell>
  );
}

function SoldOut() {
  return (
    <Shell>
      <div className="tk-title-block tk-reveal">
        <div className="tk-patch tk-title-patch">
          <h1 className="tk-title">
            <span className="l1">¡SE</span>
            <span className="l2">AGOTARON!</span>
          </h1>
        </div>
      </div>
      <div className="tk-form tk-reveal">
        <div className="tk-closed-notice" role="status">
          <strong>¡Ay! Las entradas de regalo ya se agotaron 😭</strong>
          <p>
            Llegaste tarde esta vez, pero síguenos en{' '}
            <a href={SOCIAL.instagramDm} target="_blank" rel="noopener noreferrer">
              <b>{SOCIAL.instagramHandle}</b>
            </a>{' '}
            para la próxima 🤘
          </p>
        </div>
      </div>
    </Shell>
  );
}

// Neutral screen for an unknown/invalid token — gives away nothing about gift
// campaigns. Mirrors a generic "not found" page.
function NotFound() {
  return (
    <Shell>
      <div className="tk-title-block tk-reveal">
        <div className="tk-patch tk-title-patch">
          <h1 className="tk-title">
            <span className="l1">PÁGINA</span>
            <span className="l2">NO HALLADA</span>
          </h1>
        </div>
      </div>
      <div className="tk-form tk-reveal">
        <p style={{ fontSize: 16, textAlign: 'center', margin: 0 }}>
          Este enlace no existe o ya no está disponible.
        </p>
        <p className="tk-hint" style={{ textAlign: 'center' }}>
          ¿Buscas tus entradas?{' '}
          <a href="/entradas">
            <b>Ir a la página de entradas</b>
          </a>
          .
        </p>
      </div>
    </Shell>
  );
}

function Trust() {
  return (
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
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="tk-page">
      <div className="tk-wrap">{children}</div>
    </div>
  );
}
