import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { validateTicket, type ValidateResponse } from '../shared/api';
import { playAccept, playReject } from './sound';

const PW_KEY = 'wwwy3_staff_pw';
const STATION_KEY = 'wwwy3_station';

export default function App() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(PW_KEY) ?? '');
  const [station, setStation] = useState(() => sessionStorage.getItem(STATION_KEY) ?? 'puerta-1');
  const [authed, setAuthed] = useState(false);

  if (!authed) {
    return (
      <Gate
        password={password}
        setPassword={setPassword}
        station={station}
        setStation={setStation}
        onSuccess={() => {
          sessionStorage.setItem(PW_KEY, password);
          sessionStorage.setItem(STATION_KEY, station);
          setAuthed(true);
        }}
      />
    );
  }
  return <Scanner password={password} station={station} />;
}

function Gate({
  password,
  setPassword,
  station,
  setStation,
  onSuccess
}: {
  password: string;
  setPassword: (v: string) => void;
  station: string;
  setStation: (v: string) => void;
  onSuccess: () => void;
}) {
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError('');
    // Probe with an obviously-forged token: a wrong password returns 401,
    // a correct one returns 200 with result 'forged'. Either way no DB write.
    try {
      await validateTicket(password, 'PROBE', station);
      onSuccess();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 401) setError('Contraseña incorrecta.');
      else setError('Error de conexión.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400 }}>
      <form className="card" onSubmit={submit}>
        <h1 style={{ marginTop: 0 }}>Validador de puerta</h1>
        <label htmlFor="station">Estación</label>
        <input id="station" value={station} onChange={(e) => setStation(e.target.value)} />
        <label htmlFor="pw">Contraseña de staff</label>
        <input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <div className="alert alert--error">{error}</div>}
        <button type="submit" disabled={checking} style={{ width: '100%' }}>
          {checking ? 'Verificando…' : 'Iniciar'}
        </button>
      </form>
    </div>
  );
}

type GateState =
  | { kind: 'scanning' }
  | { kind: 'checking' }
  | { kind: 'result'; response: ValidateResponse };

function Scanner({ password, station }: { password: string; station: string }) {
  const [state, setState] = useState<GateState>({ kind: 'scanning' });
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lockRef = useRef(false); // prevents re-entrant scans while processing
  const stateRef = useRef(state);
  stateRef.current = state;

  const handleScan = useCallback(
    async (decodedText: string) => {
      if (lockRef.current) return;
      lockRef.current = true;
      const scanner = scannerRef.current;
      try {
        await scanner?.pause(true);
      } catch {
        /* ignore */
      }
      setState({ kind: 'checking' });
      try {
        const response = await validateTicket(password, decodedText, station);
        if (response.result === 'valid') playAccept();
        else playReject();
        setState({ kind: 'result', response });
      } catch {
        playReject();
        setState({
          kind: 'result',
          response: { result: 'forged', tier: null, usedAt: null, usedBy: null, buyerName: null }
        });
      }
      // Auto-resume after showing the result.
      window.setTimeout(() => {
        setState({ kind: 'scanning' });
        try {
          scanner?.resume();
        } catch {
          /* ignore */
        }
        lockRef.current = false;
      }, 2500);
    },
    [password, station]
  );

  useEffect(() => {
    const scanner = new Html5Qrcode('reader', { verbose: false });
    scannerRef.current = scanner;
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => {
          void handleScan(decoded);
        },
        () => {
          /* per-frame decode errors are normal; ignore */
        }
      )
      .catch(() => {
        // Camera permission denied or unavailable.
      });

    return () => {
      scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {});
    };
  }, [handleScan]);

  return (
    <div className="container">
      <h1>Escanea la entrada — {station}</h1>
      <div id="reader" />
      {state.kind === 'checking' && <p className="muted">Verificando…</p>}
      {state.kind === 'result' && <ResultOverlay response={state.response} />}
      <p className="muted" style={{ fontSize: 13 }}>
        Apunta la cámara al código QR. El resultado se muestra automáticamente.
      </p>
    </div>
  );
}

function ResultOverlay({ response }: { response: ValidateResponse }) {
  const isValid = response.result === 'valid';
  const tierLabel = response.tier === 'preventa' ? 'Preventa' : response.tier === 'general' ? 'General' : '';

  let title: string;
  let detail = '';
  if (isValid) {
    title = '✓ VÁLIDA';
    detail = [tierLabel, response.buyerName].filter(Boolean).join(' · ');
  } else if (response.result === 'already_used') {
    title = '✗ YA USADA';
    const t = response.usedAt ? new Date(response.usedAt) : null;
    detail = t
      ? `Usada a las ${t.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}`
      : 'Esta entrada ya fue validada';
  } else if (response.result === 'not_found') {
    title = '✗ NO EXISTE';
  } else if (response.result === 'forged') {
    title = '✗ FALSA';
    detail = 'Firma inválida';
  } else {
    title = '✗ ANULADA';
  }

  return (
    <div className={`gate-result ${isValid ? 'gate-result--valid' : 'gate-result--reject'}`}>
      <div className="gate-result__icon">{isValid ? '🎟️' : '🚫'}</div>
      <div className="gate-result__title">{title}</div>
      {detail && <div className="gate-result__detail">{detail}</div>}
    </div>
  );
}
