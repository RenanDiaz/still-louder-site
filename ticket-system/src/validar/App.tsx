import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  listGateEvents,
  validateTicket,
  type GateEvent,
  type ValidateResponse
} from '../shared/api';
import { TIER_LABELS } from '../shared/config';
import { playAccept, playReject } from './sound';

const PW_KEY = 'sl_staff_pw';
const STATION_KEY = 'sl_station';
const EVENT_KEY = 'sl_gate_event';

export default function App() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(PW_KEY) ?? '');
  const [station, setStation] = useState(() => sessionStorage.getItem(STATION_KEY) ?? 'puerta-1');
  const [events, setEvents] = useState<GateEvent[] | null>(null);
  const [event, setEvent] = useState<GateEvent | null>(null);

  if (!events) {
    return (
      <Gate
        password={password}
        setPassword={setPassword}
        station={station}
        setStation={setStation}
        onSuccess={(list) => {
          sessionStorage.setItem(PW_KEY, password);
          sessionStorage.setItem(STATION_KEY, station);
          setEvents(list);
        }}
      />
    );
  }
  if (!event) {
    return (
      <EventPicker
        events={events}
        onPick={(picked) => {
          sessionStorage.setItem(EVENT_KEY, picked.slug);
          setEvent(picked);
        }}
      />
    );
  }
  return (
    <Scanner
      password={password}
      station={station}
      event={event}
      onChangeEvent={() => setEvent(null)}
    />
  );
}

// The staffer picks which event this station admits. Default: the one used
// last on this device, else the soonest (the server lists soonest first). A QR
// from any other event is rejected as 'wrong_event' without being consumed.
function EventPicker({ events, onPick }: { events: GateEvent[]; onPick: (e: GateEvent) => void }) {
  const remembered = sessionStorage.getItem(EVENT_KEY);
  const [slug, setSlug] = useState(
    () => events.find((e) => e.slug === remembered)?.slug ?? events[0]?.slug ?? ''
  );

  if (events.length === 0) {
    return (
      <div className="container" style={{ maxWidth: 400 }}>
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Sin eventos activos</h1>
          <p className="muted">
            No hay ningún evento en venta o por comenzar. Pide al admin que revise el estado del
            evento en el panel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 400 }}>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          const picked = events.find((ev) => ev.slug === slug);
          if (picked) onPick(picked);
        }}
      >
        <h1 style={{ marginTop: 0 }}>¿Qué evento validas?</h1>
        <label htmlFor="event">Evento</label>
        <select id="event" value={slug} onChange={(e) => setSlug(e.target.value)}>
          {events.map((ev) => (
            <option key={ev.slug} value={ev.slug}>
              {ev.name} ·{' '}
              {new Date(ev.startsAt).toLocaleDateString('es-PA', {
                day: 'numeric',
                month: 'short',
                timeZone: 'America/Panama'
              })}
            </option>
          ))}
        </select>
        <button type="submit" style={{ width: '100%' }}>
          Abrir lector
        </button>
      </form>
    </div>
  );
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
  onSuccess: (events: GateEvent[]) => void;
}) {
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError('');
    // The staff-gated event list doubles as the login check: a wrong password
    // returns 401. No ticket is touched.
    try {
      const { events } = await listGateEvents(password);
      onSuccess(events);
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
  { kind: 'scanning' } | { kind: 'checking' } | { kind: 'result'; response: ValidateResponse };

function Scanner({
  password,
  station,
  event,
  onChangeEvent
}: {
  password: string;
  station: string;
  event: GateEvent;
  onChangeEvent: () => void;
}) {
  // The camera is only live while `active`. When the tab is backgrounded we
  // drop to stand-by so the phone stops draining battery; the staffer reopens
  // the reader with a tap. Unmounting ScannerActive stops the camera cleanly.
  const [active, setActive] = useState(true);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setActive(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!active) {
    return (
      <Standby
        station={station}
        event={event}
        onResume={() => setActive(true)}
        onChangeEvent={onChangeEvent}
      />
    );
  }
  return (
    <ScannerActive
      password={password}
      station={station}
      event={event}
      onStandby={() => setActive(false)}
    />
  );
}

function Standby({
  station,
  event,
  onResume,
  onChangeEvent
}: {
  station: string;
  event: GateEvent;
  onResume: () => void;
  onChangeEvent: () => void;
}) {
  return (
    <div className="container" style={{ maxWidth: 400, textAlign: 'center' }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>En espera — {station}</h1>
        <p className="muted">
          Evento: <b>{event.name}</b>
        </p>
        <p className="muted">
          La cámara está apagada para ahorrar batería. Abre el lector cuando llegue alguien.
        </p>
        <button type="button" onClick={onResume} style={{ width: '100%' }}>
          Abrir lector de QR
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onChangeEvent}
          style={{ width: '100%', marginTop: 8 }}
        >
          Cambiar de evento
        </button>
      </div>
    </div>
  );
}

function ScannerActive({
  password,
  station,
  event,
  onStandby
}: {
  password: string;
  station: string;
  event: GateEvent;
  onStandby: () => void;
}) {
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
        const response = await validateTicket(password, decodedText, station, event.slug);
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
    [password, station, event.slug]
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
      <p className="muted" style={{ marginTop: -8 }}>
        Evento: <b>{event.name}</b>
      </p>
      <div id="reader" />
      {state.kind === 'checking' && <p className="muted">Verificando…</p>}
      {state.kind === 'result' && <ResultOverlay response={state.response} />}
      <p className="muted" style={{ fontSize: 13 }}>
        Apunta la cámara al código QR. El resultado se muestra automáticamente.
      </p>
      <button type="button" className="secondary" onClick={onStandby} style={{ width: '100%' }}>
        Pausar lector
      </button>
    </div>
  );
}

function ResultOverlay({ response }: { response: ValidateResponse }) {
  const isValid = response.result === 'valid';
  const tierLabel = response.tier ? (TIER_LABELS[response.tier] ?? response.tier) : '';

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
  } else if (response.result === 'wrong_event') {
    // QR auténtico pero de OTRO evento: no se consumió nada. Nombrar el evento
    // del QR para que el staff pueda orientar a la persona.
    title = '✗ OTRO EVENTO';
    detail = response.qrEventName
      ? `Esta entrada es para: ${response.qrEventName}`
      : 'Esta entrada es de otro evento';
  } else if (response.result === 'event_closed') {
    // El evento terminó: el backend no valida más QR (event_end). No es un
    // rechazo del boleto — la puerta está cerrada.
    title = '✗ PUERTA CERRADA';
    detail = 'El evento ya terminó';
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
