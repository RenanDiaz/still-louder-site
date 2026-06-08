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
  const markerFont = "'Permanent Marker','Arial Black',Arial,Helvetica,sans-serif";
  const patchFont = "'Arial Black',Arial,Helvetica,sans-serif";

  // Un toque del tema: morado/rosa y un titular tipo marcador. SOLO estilos
  // inline + tablas (los clientes de correo eliminan filtros SVG / mix-blend-mode).
  // Cada QR va dentro de algo que parece un boleto de show: franja morada de
  // cabecera, cuerpo blanco con el QR súper legible y un talón con línea de
  // perforación punteada.
  const qrBlocks = tokens
    .map((token, i) => {
      const src = `${env.publicBaseUrl}/api/tickets/qr?t=${encodeURIComponent(token)}`;
      return `
        <table role="presentation" width="320" cellpadding="0" cellspacing="0" align="center"
               style="margin:22px auto;background:#ffffff;border:2px solid #15121c;border-radius:10px;border-collapse:separate;overflow:hidden;">
          <tr>
            <td style="background:#3e2768;padding:12px 16px;text-align:center;">
              <div style="font-family:${markerFont};font-size:18px;color:#ff2e93;line-height:1;">When We Were Young 3</div>
              <div style="font-family:${patchFont};font-size:12px;letter-spacing:2px;color:#ffffff;margin-top:4px;text-transform:uppercase;">
                1 AGO · HOPS · ${escapeHtml(tierLabel)}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 16px 6px;text-align:center;">
              <div style="font-family:${patchFont};font-size:12px;letter-spacing:2px;color:#15121c;text-transform:uppercase;margin-bottom:10px;">
                ADMISIÓN ${i + 1} DE ${tokens.length}
              </div>
              <img src="${src}" width="220" height="220"
                   alt="Código QR de tu entrada ${i + 1}"
                   style="display:block;margin:0 auto;background:#fff;" />
            </td>
          </tr>
          <tr>
            <td style="padding:0 16px;">
              <div style="border-top:2px dashed #c9aef0;height:1px;font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 16px 16px;text-align:center;">
              <span style="font-family:${patchFont};font-size:14px;letter-spacing:3px;color:#ff2e93;text-transform:uppercase;">★ ADMIT ONE ★</span>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#5a5468;margin-top:6px;">
                Válido para una sola admisión · Orden #${order.id}
              </div>
            </td>
          </tr>
        </table>`;
    })
    .join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#15121c;background:#f4eee1;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#3e2768;">
        <tr>
          <td style="padding:26px 24px;text-align:center;">
            <div style="font-family:${markerFont};font-size:14px;color:#ff2e93;letter-spacing:1px;margin-bottom:6px;">
              STILL LOUDER · WWWY3
            </div>
            <div style="font-family:${markerFont};font-size:26px;color:#ffffff;line-height:1.15;">
              ¡Tu entrada está lista! 🎸
            </div>
          </td>
        </tr>
      </table>

      <div style="padding:24px;">
        <p style="margin:0 0 16px;">Hola ${escapeHtml(order.buyer_name)}, gracias por tu compra.</p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border:1px solid #d9cdb5;border-radius:8px;">
          <tr>
            <td style="padding:16px 18px;font-size:15px;line-height:1.8;color:#15121c;">
              <strong>Evento:</strong> When We Were Young 3 (Still Louder)<br/>
              <strong>Lugar:</strong> Hops<br/>
              <strong>Fecha:</strong> 1 de agosto<br/>
              <strong>Tipo:</strong> ${escapeHtml(tierLabel)}<br/>
              <strong>Cantidad:</strong> ${order.quantity} ${order.quantity === 1 ? 'entrada' : 'entradas'}
            </td>
          </tr>
        </table>

        <p style="margin:18px 0 0;">Presenta ${tokens.length === 1 ? 'este código QR' : 'estos códigos QR'} en la puerta.
           Cada código es válido para una sola admisión.</p>
        ${qrBlocks}
        <hr style="border:none;border-top:1px solid #d9cdb5;margin:24px 0;" />
        <p style="font-size:12px;color:#5a5468;">
          Orden #${order.id}. Si tienes dudas, responde a este correo.
          Canales oficiales: <strong style="color:#c01a5b;">@stilllouder</strong>.
        </p>
      </div>
    </div>`;

  await getResend().emails.send({
    from: env.emailFrom,
    to: order.buyer_email,
    subject: 'Tu entrada para WWWY3 — Still Louder',
    html,
    attachments
  });
}
