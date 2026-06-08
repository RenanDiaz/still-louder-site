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
    <div className="tk-countdown">
      <p className="tk-countdown__label">{label}</p>
      <div className="tk-countdown__cells">
        {[
          { v: days, l: 'días' },
          { v: hours, l: 'horas' },
          { v: minutes, l: 'min' },
          { v: seconds, l: 'seg' }
        ].map((part) => (
          <div key={part.l} className="tk-patch tk-cell">
            <span className="n">{String(part.v).padStart(2, '0')}</span>
            <span className="lbl">{part.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
