import { Resend } from 'resend';
import { env } from './env.js';
import { tokenToPngBuffer } from './qr.js';
import type { Order } from './types.js';

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

const TIER_LABEL: Record<string, string> = {
  preventa: 'Preventa',
  general: 'General'
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sends ONE confirmation email per order, with one QR per admission.
 * Each QR is shown inline via a hosted, stateless image URL (renders in every
 * mail client and stays scannable on screen) and also attached as a PNG fallback.
 */
export async function sendTicketEmail(order: Order, tokens: string[]): Promise<void> {
  const attachments = await Promise.all(
    tokens.map(async (token, i) => ({
      filename: `entrada-${i + 1}.png`,
      content: await tokenToPngBuffer(token)
    }))
  );

  const tierLabel = TIER_LABEL[order.tier] ?? order.tier;
  const qrBlocks = tokens
    .map((token, i) => {
      const src = `${env.publicBaseUrl}/api/tickets/qr?t=${encodeURIComponent(token)}`;
      return `
        <div style="margin:24px 0;text-align:center;">
          <p style="margin:0 0 8px;font-weight:bold;">Admisión ${i + 1} de ${tokens.length}</p>
          <img src="${src}" width="240" height="240"
               alt="Código QR de tu entrada ${i + 1}"
               style="border:1px solid #eee;border-radius:8px;" />
        </div>`;
    })
    .join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111;">
      <h1 style="font-size:22px;">¡Tu entrada para WWWY3 está lista! 🎸</h1>
      <p>Hola ${escapeHtml(order.buyer_name)}, gracias por tu compra.</p>
      <p style="margin:16px 0;">
        <strong>Evento:</strong> When We Were Young 3 (Still Louder)<br/>
        <strong>Lugar:</strong> Hops<br/>
        <strong>Fecha:</strong> 1 de agosto<br/>
        <strong>Tipo:</strong> ${escapeHtml(tierLabel)}<br/>
        <strong>Cantidad:</strong> ${order.quantity} ${order.quantity === 1 ? 'entrada' : 'entradas'}
      </p>
      <p>Presenta ${tokens.length === 1 ? 'este código QR' : 'estos códigos QR'} en la puerta.
         Cada código es válido para una sola admisión.</p>
      ${qrBlocks}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="font-size:12px;color:#666;">
        Orden #${order.id}. Si tienes dudas, responde a este correo.
        Canales oficiales: @stilllouder.
      </p>
    </div>`;

  await getResend().emails.send({
    from: env.emailFrom,
    to: order.buyer_email,
    subject: 'Tu entrada para WWWY3 — Still Louder',
    html,
    attachments
  });
}
