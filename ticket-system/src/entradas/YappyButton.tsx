import { useEffect, useRef, useState } from 'react';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import { createYappyPayment } from '../shared/api';

// =============================================================================
// <YappyButton> — wrapper around Yappy's <btn-yappy> web component.
// =============================================================================
// Flow: eventClick -> POST /api/yappy/create-order (the two Yappy calls happen
// server-side) -> eventPayment({transactionId, token, documentName}) opens the
// charge in the buyer's Yappy app. eventSuccess/eventError are UX-only; the
// order is marked paid exclusively by the server-side IPN, which the parent
// observes by polling the order status.
// =============================================================================

interface BtnYappyElement extends HTMLElement {
  eventPayment: (params: { transactionId: string; token: string; documentName: string }) => void;
  isYappyOnline?: () => Promise<boolean> | boolean;
  isButtonLoading?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'btn-yappy': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        theme?: string;
        rounded?: string;
      };
    }
  }
}

// The CDN script is loaded once per page, lazily, with the URL the server
// chose (UAT vs prod). Module scope so re-mounts don't re-inject it.
let cdnPromise: Promise<void> | null = null;
function loadYappyCdn(src: string): Promise<void> {
  if (!cdnPromise) {
    cdnPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => {
        cdnPromise = null; // allow a retry on next mount
        reject(new Error('yappy_cdn_failed'));
      };
      document.head.appendChild(script);
    });
  }
  return cdnPromise;
}

export interface YappyButtonProps {
  orderId: string;
  cdnUrl: string;
  /** UX-only: the buyer approved in their app; confirmation still comes via IPN. */
  onPaymentSent: () => void;
  onError: (message: string) => void;
}

export function YappyButton({ orderId, cdnUrl, onPaymentSent, onError }: YappyButtonProps) {
  const ref = useRef<BtnYappyElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    loadYappyCdn(cdnUrl)
      .then(async () => {
        if (cancelled) return;
        setState('ready');
        // isYappyOnline: channel health check — disable + explain when down.
        try {
          const el = ref.current;
          if (el && typeof el.isYappyOnline === 'function') {
            const online = await el.isYappyOnline();
            if (!cancelled && online === false) setState('offline');
          }
        } catch {
          // health check failing is not fatal; let the buyer try
        }
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [cdnUrl]);

  useEffect(() => {
    const el = ref.current;
    if (!el || state !== 'ready') return;

    const handleClick = async () => {
      try {
        el.isButtonLoading = true;
        const session = await createYappyPayment(orderId);
        el.eventPayment(session);
      } catch (err) {
        el.isButtonLoading = false;
        const code = (err as Error & { code?: string }).code;
        if (code === 'reservation_expired' || code === 'order_cancelled') {
          onError('Tu reserva expiró. Crea una nueva orden para volver a intentar.');
        } else if (code === 'order_already_paid') {
          onPaymentSent(); // polling will surface the paid state
        } else {
          onError('No pudimos iniciar el pago con Yappy. Inténtalo de nuevo.');
        }
      }
    };
    const handleSuccess = () => onPaymentSent();
    const handleError = () => {
      onError('El pago no se completó. Puedes intentarlo de nuevo.');
    };

    el.addEventListener('eventClick', handleClick);
    el.addEventListener('eventSuccess', handleSuccess);
    el.addEventListener('eventError', handleError);
    return () => {
      el.removeEventListener('eventClick', handleClick);
      el.removeEventListener('eventSuccess', handleSuccess);
      el.removeEventListener('eventError', handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, orderId]);

  if (state === 'failed') {
    return (
      <div className="tk-alert tk-alert--error" role="alert">
        No pudimos cargar el botón de Yappy. Refresca la página para reintentar.
      </div>
    );
  }
  if (state === 'offline') {
    return (
      <div className="tk-alert tk-alert--error" role="alert">
        Yappy no está disponible en este momento. Inténtalo más tarde o usa otro método de pago.
      </div>
    );
  }

  // Brand button: Yappy only allows its official themes (blue, darkBlue,
  // orange, dark, sky, light), no custom recoloring. "blue" is the
  // characteristic Yappy look and stands out on the white card.
  return <btn-yappy ref={ref} theme="blue" rounded="true" />;
}
