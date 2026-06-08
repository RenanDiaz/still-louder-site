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
  // Tipografía email-safe que hace eco de la identidad del sitio: titulares en
  // serif (Georgia ≈ la serif dramática del hero) y etiquetas en sans pesada
  // (≈ Anton). Los clientes de correo no cargan webfonts de forma fiable.
  const serifFont = "Georgia,'Times New Roman',Times,serif";
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
              <div style="font-family:${serifFont};font-style:italic;font-size:20px;color:#ff2e93;line-height:1;">When We Were Young 3</div>
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

  const detailRow = (label: string, value: string) => `
    <tr>
      <td style="padding:7px 0;font-family:${patchFont};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8a6db0;width:96px;vertical-align:top;white-space:nowrap;">${label}</td>
      <td style="padding:7px 0;font-size:15px;color:#15121c;font-weight:bold;">${value}</td>
    </tr>`;

  // Versión clara "enmarcada": franjas oscuras arriba y abajo encierran un cuerpo
  // blanco neutro (como el papel del flyer original) con acentos morado/rosa, para
  // que no se vea plano junto al header fuerte.
  const html = `
    <div style="background:#2c1c4a;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" align="center"
             style="max-width:560px;margin:0 auto;background:#f6f5f8;border-radius:14px;overflow:hidden;color:#15121c;">
        <!-- Header oscuro + barra rosa de acento que puentea al cuerpo claro -->
        <tr>
          <td style="background:#3e2768;padding:30px 24px 26px;text-align:center;">
            <div style="font-family:${patchFont};font-size:12px;color:#ff6cb6;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">
              Still Louder · WWWY3
            </div>
            <div style="font-family:${serifFont};font-size:30px;color:#ffffff;line-height:1.1;">
              ¡Tu entrada está lista! 🎸
            </div>
          </td>
        </tr>
        <tr><td style="height:5px;background:#ff2e93;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Cuerpo claro -->
        <tr>
          <td style="padding:26px 24px 8px;">
            <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">
              Hola <strong>${escapeHtml(order.buyer_name)}</strong>, gracias por tu compra. ¡Nos vemos en el pit! 🤘
            </p>

            <!-- Tarjeta de detalles con acento lateral rosa y mini-título serif -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#ffffff;border:1px solid #e1dfe9;border-left:5px solid #ff2e93;border-radius:10px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-family:${serifFont};font-style:italic;font-size:19px;color:#3e2768;margin-bottom:10px;">
                    Detalles de tu orden
                  </div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${detailRow('Evento', 'When We Were Young 3')}
                    ${detailRow('Lugar', 'Hops')}
                    ${detailRow('Fecha', '1 de agosto')}
                    ${detailRow('Tipo', escapeHtml(tierLabel))}
                    ${detailRow('Cantidad', `${order.quantity} ${order.quantity === 1 ? 'entrada' : 'entradas'}`)}
                  </table>
                </td>
              </tr>
            </table>

            <!-- Aviso de admisión en caja lila tintada -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
              <tr>
                <td style="background:#efe6ff;border-radius:10px;padding:14px 18px;font-size:14px;line-height:1.55;color:#3e2768;">
                  Presenta ${tokens.length === 1 ? 'este código QR' : 'estos códigos QR'} en la puerta.
                  Cada código es válido para <strong>una sola admisión</strong>.
                </td>
              </tr>
            </table>
            ${qrBlocks}
          </td>
        </tr>

        <!-- Footer oscuro: bookend que enmarca el cuerpo claro -->
        <tr>
          <td style="background:#3e2768;padding:20px 24px;text-align:center;">
            <div style="font-size:13px;color:#e7dcf7;line-height:1.6;">
              ¿Dudas? Responde a este correo o escríbenos por nuestros canales oficiales:
              <strong style="color:#ff6cb6;">@stilllouder</strong>.
            </div>
            <div style="font-family:${patchFont};font-size:10px;letter-spacing:2px;color:#9b86c4;text-transform:uppercase;margin-top:10px;">
              Orden #${order.id}
            </div>
          </td>
        </tr>
      </table>
    </div>`;

  await getResend().emails.send({
    from: env.emailFrom,
    to: order.buyer_email,
    subject: 'Tu entrada para WWWY3 — Still Louder',
    html,
    attachments
  });
}
