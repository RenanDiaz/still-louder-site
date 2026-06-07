import { useEffect, useState } from 'react';
import { EVENT } from '../shared/config';

function diffParts(target: number, now: number) {
  const ms = Math.max(target - now, 0);
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return { ms, days, hours, minutes, seconds };
}

export function Countdown() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const presaleStart = new Date(EVENT.presaleStart).getTime();
  const eventDate = new Date(EVENT.eventDate).getTime();

  // Before presale opens we count down to that; afterwards, to the show.
  const beforePresale = now < presaleStart;
  const target = beforePresale ? presaleStart : eventDate;
  const label = beforePresale ? 'La preventa abre en' : 'Faltan para el concierto';
  const { days, hours, minutes, seconds } = diffParts(target, now);

  return (
    <div style={{ marginBottom: 16 }}>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        {label}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { v: days, l: 'días' },
          { v: hours, l: 'horas' },
          { v: minutes, l: 'min' },
          { v: seconds, l: 'seg' }
        ].map((part) => (
          <div key={part.l} className="stat" style={{ flex: 1 }}>
            <div className="stat__value">{String(part.v).padStart(2, '0')}</div>
            <div className="stat__label">{part.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
