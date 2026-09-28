import { Resend } from 'resend';
import { env } from './env.js';
import { tokenToPngBuffer } from './qr.js';
import { buildWalletSaveUrl } from './google-wallet.js';
import { formatEventDateTime, formatEventShortDay, type EventRow } from './events.js';
import type { Order } from './types.js';

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

const TIER_LABEL: Record<string, string> = {
  preventa: 'Preventa',
  general: 'General',
  cortesia: 'Cortesía',
  regalo: 'Regalo'
};

const METHOD_LABEL: Record<string, string> = {
  yappy: 'Yappy',
  cuantoapp: 'Tarjeta (CuantoApp)',
  cash: 'Efectivo',
  courtesy: 'Cortesía'
};

// Paleta por tema del evento (events.theme). Solo colores inline: los clientes
// de correo no cargan CSS externo. `wwwy3` conserva el morado/rosa original;
// cualquier otro tema cae en `mono` (negro + hueso), sin heredar la identidad
// de WWWY3.
interface EmailPalette {
  frame: string;
  header: string;
  accent: string;
  accentOnDark: string;
  tint: string;
  perforation: string;
  label: string;
  footerText: string;
  footerMuted: string;
}

const PALETTES: Record<string, EmailPalette> = {
  wwwy3: {
    frame: '#2c1c4a',
    header: '#3e2768',
    accent: '#ff2e93',
    accentOnDark: '#ff6cb6',
    tint: '#efe6ff',
    perforation: '#c9aef0',
    label: '#8a6db0',
    footerText: '#e7dcf7',
    footerMuted: '#9b86c4'
  },
  mono: {
    frame: '#0b0b0b',
    header: '#161616',
    accent: '#8a1c1c',
    accentOnDark: '#e8e2d4',
    tint: '#efebe2',
    perforation: '#c9c2b2',
    label: '#6f6857',
    footerText: '#d8d2c4',
    footerMuted: '#9a9383'
  }
};

function paletteFor(theme: string): EmailPalette {
  return PALETTES[theme] ?? PALETTES.mono;
}

function formatMoney(totalCents: number): string {
  return `$${(totalCents / 100).toFixed(2)}`;
}

function formatPanamaDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-PA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Panama'
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

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
export async function sendTicketEmail(order: Order, event: EventRow, tokens: string[]): Promise<void> {
  const P = paletteFor(event.theme);
  const eventName = escapeHtml(event.name);
  const ticketStrip = [formatEventShortDay(event), event.venue?.toUpperCase()]
    .filter(Boolean)
    .map((part) => escapeHtml(part as string))
    .join(' · ');
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

  // Un toque del tema (paleta del evento) y un titular tipo marcador. SOLO estilos
  // inline + tablas (los clientes de correo eliminan filtros SVG / mix-blend-mode).
  // Cada QR va dentro de algo que parece un boleto de show: franja morada de
  // cabecera, cuerpo blanco con el QR súper legible y un talón con línea de
  // perforación punteada.
  const qrBlocks = tokens
    .map((token, i) => {
      const src = `${env.publicBaseUrl}/api/tickets/qr?t=${encodeURIComponent(token)}`;
      // Optional "Add to Google Wallet" link (fase 3): only present when the
      // Wallet credentials are configured; otherwise the row is omitted.
      const walletUrl = buildWalletSaveUrl({
        token,
        buyerName: order.buyer_name,
        tier: order.tier,
        ticketNumber: `${order.id.slice(0, 8).toUpperCase()}-${i + 1}`
      });
      // Bulletproof (table + inline CSS) dark pill so it renders in every mail
      // client — no SVG/webfont reliance. Links to the pay.google.com save URL.
      const walletRow = walletUrl
        ? `
          <tr>
            <td style="padding:0 16px 14px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:24px;background:#202124;">
                    <a href="${walletUrl}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:11px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:24px;">
                      Agregar a Google Wallet
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
        : '';
      return `
        <table role="presentation" width="320" cellpadding="0" cellspacing="0" align="center"
               style="margin:22px auto;background:#ffffff;border:2px solid #15121c;border-radius:10px;border-collapse:separate;overflow:hidden;">
          <tr>
            <td style="background:${P.header};padding:12px 16px;text-align:center;">
              <div style="font-family:${serifFont};font-style:italic;font-size:20px;color:${P.accent};line-height:1;">${eventName}</div>
              <div style="font-family:${patchFont};font-size:12px;letter-spacing:2px;color:#ffffff;margin-top:4px;text-transform:uppercase;">
                ${ticketStrip} · ${escapeHtml(tierLabel)}
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
              <div style="border-top:2px dashed ${P.perforation};height:1px;font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 16px 16px;text-align:center;">
              <span style="font-family:${patchFont};font-size:14px;letter-spacing:3px;color:${P.accent};text-transform:uppercase;">★ ADMIT ONE ★</span>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#5a5468;margin-top:6px;">
                Válido para una sola admisión · Orden #${order.id}
              </div>
            </td>
          </tr>
          ${walletRow}
        </table>`;
    })
    .join('');

  const detailRow = (label: string, value: string) => `
    <tr>
      <td style="padding:7px 0;font-family:${patchFont};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${P.label};width:96px;vertical-align:top;white-space:nowrap;">${label}</td>
      <td style="padding:7px 0;font-size:15px;color:#15121c;font-weight:bold;">${value}</td>
    </tr>`;

  // "Responde a este correo" solo es honesto si hay Reply-To configurado: el
  // dominio en Resend solo envía, así que sin EMAIL_REPLY_TO una respuesta a
  // entradas@ se pierde y el footer debe apuntar únicamente a las redes.
  const replyTo = env.emailReplyTo;
  const contactLine = replyTo
    ? '¿Dudas? Responde a este correo o escríbenos por nuestros canales oficiales:'
    : '¿Dudas? Escríbenos por nuestros canales oficiales:';

  // Versión clara "enmarcada": franjas oscuras arriba y abajo encierran un cuerpo
  // blanco neutro (como el papel del flyer original) con acentos morado/rosa, para
  // que no se vea plano junto al header fuerte.
  const html = `
    <div style="background:${P.frame};padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" align="center"
             style="max-width:560px;margin:0 auto;background:#f6f5f8;border-radius:14px;overflow:hidden;color:#15121c;">
        <!-- Header oscuro + barra rosa de acento que puentea al cuerpo claro -->
        <tr>
          <td style="background:${P.header};padding:30px 24px 26px;text-align:center;">
            <div style="font-family:${patchFont};font-size:12px;color:${P.accentOnDark};letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">
              Still Louder · ${escapeHtml(event.short_name)}
            </div>
            <div style="font-family:${serifFont};font-size:30px;color:#ffffff;line-height:1.1;">
              ¡Tu entrada está lista! 🎸
            </div>
          </td>
        </tr>
        <tr><td style="height:5px;background:${P.accent};font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Cuerpo claro -->
        <tr>
          <td style="padding:26px 24px 8px;">
            <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">
              Hola <strong>${escapeHtml(order.buyer_name)}</strong>, ${
                order.payment_method === 'gift'
                  ? `¡${order.quantity === 1 ? 'te ganaste esta entrada de regalo' : 'te ganaste estas entradas de regalo'}! 🎁 ¡Nos vemos en el pit! 🤘`
                  : order.payment_method === 'courtesy'
                    ? `te ${order.quantity === 1 ? 'regalamos esta entrada' : 'regalamos estas entradas'} de cortesía. ¡Nos vemos en el pit! 🤘`
                    : 'gracias por tu compra. ¡Nos vemos en el pit! 🤘'
              }
            </p>

            <!-- Tarjeta de detalles con acento lateral rosa y mini-título serif -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#ffffff;border:1px solid #e1dfe9;border-left:5px solid ${P.accent};border-radius:10px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-family:${serifFont};font-style:italic;font-size:19px;color:${P.header};margin-bottom:10px;">
                    Detalles de tu orden
                  </div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${detailRow('Evento', eventName)}
                    ${event.venue ? detailRow('Lugar', escapeHtml(event.venue)) : ''}
                    ${detailRow('Fecha', escapeHtml(formatEventDateTime(event)))}
                    ${detailRow('Tipo', escapeHtml(tierLabel))}
                    ${detailRow('Cantidad', `${order.quantity} ${order.quantity === 1 ? 'entrada' : 'entradas'}`)}
                  </table>
                </td>
              </tr>
            </table>

            <!-- Aviso de admisión en caja lila tintada -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
              <tr>
                <td style="background:${P.tint};border-radius:10px;padding:14px 18px;font-size:14px;line-height:1.55;color:${P.header};">
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
          <td style="background:${P.header};padding:20px 24px;text-align:center;">
            <div style="font-size:13px;color:${P.footerText};line-height:1.6;">
              ${contactLine}
              <a href="https://ig.me/m/still_louder" style="color:${P.accentOnDark};text-decoration:none;"><strong>@still_louder</strong></a>.
            </div>
            <div style="font-family:${patchFont};font-size:10px;letter-spacing:2px;color:${P.footerMuted};text-transform:uppercase;margin-top:10px;">
              Orden #${order.id}
            </div>
          </td>
        </tr>
      </table>
    </div>`;

  await getResend().emails.send({
    from: env.emailFrom,
    to: order.buyer_email,
    ...(replyTo ? { replyTo } : {}),
    subject: `Tu entrada para ${event.short_name} — Still Louder`,
    html,
    attachments
  });
}

/**
 * Aviso interno al operador cuando se REGISTRA una compra (orden creada, aún
 * pendiente de pago). Best-effort: el endpoint de compra nunca debe fallar por
 * esto. Solo se envía si ORDER_NOTIFICATION_EMAIL está configurada.
 */
export async function sendOrderNotificationEmail(order: Order, event: EventRow): Promise<void> {
  const recipients = env.orderNotificationEmail
    .split(',')
    .map((addr) => addr.trim())
    .filter(Boolean);
  if (recipients.length === 0) return;

  const tierLabel = TIER_LABEL[order.tier] ?? order.tier;
  const methodLabel = METHOD_LABEL[order.payment_method] ?? order.payment_method;
  const adminUrl = `${env.publicBaseUrl}/admin`;
  const P = paletteFor(event.theme);

  const serifFont = "Georgia,'Times New Roman',Times,serif";
  const patchFont = "'Arial Black',Arial,Helvetica,sans-serif";

  const detailRow = (label: string, value: string) => `
    <tr>
      <td style="padding:7px 0;font-family:${patchFont};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${P.label};width:110px;vertical-align:top;white-space:nowrap;">${label}</td>
      <td style="padding:7px 0;font-size:15px;color:#15121c;font-weight:bold;">${value}</td>
    </tr>`;

  const phoneRow = order.buyer_phone ? detailRow('Teléfono', escapeHtml(order.buyer_phone)) : '';

  const html = `
    <div style="background:${P.frame};padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" align="center"
             style="max-width:560px;margin:0 auto;background:#f6f5f8;border-radius:14px;overflow:hidden;color:#15121c;">
        <tr>
          <td style="background:${P.header};padding:28px 24px 24px;text-align:center;">
            <div style="font-family:${patchFont};font-size:12px;color:${P.accentOnDark};letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">
              Still Louder · ${escapeHtml(event.short_name)}
            </div>
            <div style="font-family:${serifFont};font-size:27px;color:#ffffff;line-height:1.15;">
              Nueva compra registrada 🎟️
            </div>
          </td>
        </tr>
        <tr><td style="height:5px;background:${P.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:26px 24px 8px;">
            <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">
              Se registró una orden <strong>pendiente de pago</strong>. Revisa los detalles y
              márcala como pagada en el panel cuando confirmes el pago.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background:#ffffff;border:1px solid #e1dfe9;border-left:5px solid ${P.accent};border-radius:10px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-family:${serifFont};font-style:italic;font-size:19px;color:${P.header};margin-bottom:10px;">
                    Detalles de la orden
                  </div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${detailRow('Evento', escapeHtml(event.name))}
                    ${detailRow('Comprador', escapeHtml(order.buyer_name))}
                    ${detailRow('Correo', escapeHtml(order.buyer_email))}
                    ${phoneRow}
                    ${detailRow('Tipo', escapeHtml(tierLabel))}
                    ${detailRow('Cantidad', `${order.quantity} ${order.quantity === 1 ? 'entrada' : 'entradas'}`)}
                    ${
                      order.fee_cents > 0
                        ? detailRow('Neto (banda)', formatMoney(order.net_cents)) +
                          detailRow('Cargo por servicio', formatMoney(order.fee_cents))
                        : ''
                    }
                    ${detailRow('Total cobrado', formatMoney(order.total_cents))}
                    ${detailRow('Pago', escapeHtml(methodLabel))}
                    ${detailRow('Fecha', escapeHtml(formatPanamaDate(order.created_at)))}
                    ${detailRow('Orden', `#${order.id}`)}
                  </table>
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
              <tr>
                <td align="center">
                  <a href="${adminUrl}"
                     style="display:inline-block;background:${P.accent};color:#ffffff;text-decoration:none;
                            font-family:${patchFont};font-size:14px;letter-spacing:2px;text-transform:uppercase;
                            padding:14px 28px;border-radius:8px;">
                    Abrir panel de administración
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${P.header};padding:18px 24px;text-align:center;">
            <div style="font-family:${patchFont};font-size:10px;letter-spacing:2px;color:${P.footerMuted};text-transform:uppercase;">
              Aviso automático · Sistema de entradas
            </div>
          </td>
        </tr>
      </table>
    </div>`;

  await getResend().emails.send({
    from: env.emailFrom,
    to: recipients,
    subject: `Nueva compra ${event.short_name}: ${order.buyer_name} · ${order.quantity}x ${tierLabel} · ${formatMoney(order.total_cents)}`,
    html
  });
}
