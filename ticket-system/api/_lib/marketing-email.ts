import { env } from './env.js';
import { escapeHtml, paletteFor } from './email.js';

// =============================================================================
// Plantilla de las campañas de promoción (docs/features/campanas-promocion.md)
// =============================================================================
// Una sola plantilla fija (D9) con la paleta `mono` de email.ts. El cuerpo es
// Markdown MÍNIMO renderizado aquí, sin dependencia: párrafos, ##/### títulos,
// listas con "- ", **negrita**, *cursiva*, [texto](https://…) y URLs sueltas.
// Todo el input se escapa ANTES de interpretar el Markdown, así que no hay
// forma de colar HTML (D9: sin HTML libre).
//
// Sin pixel ni reescritura de enlaces (D7): los enlaces van tal cual, solo con
// UTM en los dominios propios. Las únicas imágenes son el logo y la imagen
// opcional de la campaña, iguales para todos los destinatarios.
// =============================================================================

export type ConsentSource = 'legacy_buyer' | 'checkout_opt_in';

export interface CampaignContent {
  slug: string;
  subject: string;
  preheader: string;
  body_md: string;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
}

export interface RecipientContext {
  name: string | null;
  consentSource: ConsentSource;
  // Página /baja?t=… (enlace visible del pie).
  unsubscribeUrl: string;
}

// UTM solo hacia nuestros sitios; un enlace a Spotify o Instagram va intacto.
const UTM_HOSTS = new Set(['still-louder.com', 'entradas.still-louder.com']);

export function withUtm(rawUrl: string, slug: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (!UTM_HOSTS.has(url.hostname)) return rawUrl;
  url.searchParams.set('utm_source', 'email');
  url.searchParams.set('utm_medium', 'campaign');
  url.searchParams.set('utm_campaign', slug);
  return url.toString();
}

// --- Markdown mínimo ------------------------------------------------------------

// Sobre texto YA escapado: los & de una URL llegan como &amp;.
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

function unescapeUrl(escaped: string): string {
  return escaped.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function inlineHtml(escaped: string, slug: string, linkColor: string): string {
  const links: string[] = [];
  const withPlaceholders = escaped.replace(LINK_RE, (_m, text: string | undefined, href: string | undefined, bare: string | undefined) => {
    const target = withUtm(unescapeUrl((href ?? bare)!), slug);
    const label = text ?? bare!;
    links.push(
      `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer" style="color:${linkColor};text-decoration:underline;">${label}</a>`
    );
    return `\u0000${links.length - 1}\u0000`;
  });
  return withPlaceholders
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)]);
}

function inlineText(raw: string, slug: string): string {
  return raw
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, text: string, href: string) =>
      href.startsWith('mailto:') ? `${text} (${href.slice(7)})` : `${text} (${withUtm(href, slug)})`
    )
    .replace(/(^|[^(])(https?:\/\/[^\s<)]+[^\s<.,;:!?)])/g, (m, pre: string, url: string) =>
      url.includes('utm_source=') ? m : `${pre}${withUtm(url, slug)}`
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1$2');
}

type Block = { kind: 'h2' | 'h3' | 'p'; lines: string[] } | { kind: 'ul'; lines: string[] };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  // \u0000 is the link placeholder in inlineHtml(); it can never come from the input.
  for (const chunk of md.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (heading && lines.length === 1) {
      blocks.push({ kind: heading[1].length === 3 ? 'h3' : 'h2', lines: [heading[2]] });
    } else if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      blocks.push({ kind: 'ul', lines: lines.map((l) => l.replace(/^\s*[-*]\s+/, '')) });
    } else {
      blocks.push({ kind: 'p', lines });
    }
  }
  return blocks;
}

export function markdownToHtml(md: string, slug: string, linkColor: string): string {
  const serifFont = "Georgia,'Times New Roman',Times,serif";
  return parseBlocks(md)
    .map((b) => {
      const inl = (s: string) => inlineHtml(escapeHtml(s), slug, linkColor);
      if (b.kind === 'h2' || b.kind === 'h3') {
        const size = b.kind === 'h2' ? 22 : 18;
        return `<p style="margin:22px 0 10px;font-family:${serifFont};font-size:${size}px;line-height:1.25;color:#15121c;">${inl(b.lines[0])}</p>`;
      }
      if (b.kind === 'ul') {
        const items = b.lines.map((l) => `<li style="margin:0 0 6px;">${inl(l)}</li>`).join('');
        return `<ul style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;">${items}</ul>`;
      }
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${b.lines.map(inl).join('<br />')}</p>`;
    })
    .join('\n');
}

export function markdownToText(md: string, slug: string): string {
  return parseBlocks(md)
    .map((b) => {
      if (b.kind === 'ul') return b.lines.map((l) => `- ${inlineText(l, slug)}`).join('\n');
      if (b.kind === 'h2' || b.kind === 'h3') return inlineText(b.lines[0], slug).toUpperCase();
      return b.lines.map((l) => inlineText(l, slug)).join('\n');
    })
    .join('\n\n');
}

// --- Plantilla ---------------------------------------------------------------------

function firstName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

// El pie dice por qué le escribimos según de dónde salió el consentimiento (D4).
function reasonLine(consent: ConsentSource): string {
  return consent === 'checkout_opt_in'
    ? 'Te escribimos porque pediste recibir noticias de Still Louder al comprar tus entradas.'
    : 'Te escribimos porque compraste o recibiste entradas para un show de Still Louder.';
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Prepara una campaña una sola vez (Markdown, CTA, imagen) y devuelve un
 * renderizador barato por destinatario: solo cambian el saludo, el motivo del
 * pie y el enlace de baja.
 */
export function prepareCampaignEmail(c: CampaignContent): (r: RecipientContext) => RenderedEmail {
  const P = paletteFor('mono');
  const serifFont = "Georgia,'Times New Roman',Times,serif";
  const patchFont = "'Arial Black',Arial,Helvetica,sans-serif";
  const bodyHtml = markdownToHtml(c.body_md, c.slug, P.accent);
  const bodyText = markdownToText(c.body_md, c.slug);
  const ctaUrl = c.cta_url && c.cta_label ? withUtm(c.cta_url, c.slug) : null;
  const logoUrl = `${env.publicBaseUrl}/apple-touch-icon.png`;
  const replyTo = env.emailReplyTo;

  // Texto oculto que los clientes muestran junto al asunto; el relleno evita
  // que arrastren el inicio del cuerpo detrás del preheader.
  const preheaderHtml = c.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${P.frame};opacity:0;">${escapeHtml(c.preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>`
    : '';

  const imageHtml = c.image_url
    ? `<tr><td style="padding:0;"><img src="${escapeHtml(c.image_url)}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0;" /></td></tr>`
    : '';

  const ctaHtml = ctaUrl
    ? `
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto 6px;">
              <tr>
                <td style="border-radius:8px;background:${P.accent};">
                  <a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer"
                     style="display:inline-block;padding:14px 28px;font-family:${patchFont};font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:8px;">
                    ${escapeHtml(c.cta_label!)}
                  </a>
                </td>
              </tr>
            </table>`
    : '';

  const replyLine = replyTo
    ? '¿Quieres decirnos algo? Responde a este correo: lo leemos nosotros.'
    : '';

  return (r: RecipientContext): RenderedEmail => {
    const first = firstName(r.name);
    const greeting = first ? `Hola, ${first}:` : 'Hola:';
    const unsubscribeHref = escapeHtml(r.unsubscribeUrl);

    const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(c.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:${P.frame};">
    ${preheaderHtml}
    <div style="background:${P.frame};padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" align="center"
             style="max-width:560px;margin:0 auto;background:#f6f5f2;border-radius:14px;overflow:hidden;color:#15121c;">
        <tr>
          <td style="background:${P.header};padding:22px 24px;text-align:center;">
            <img src="${logoUrl}" width="56" height="56" alt="Still Louder"
                 style="display:block;margin:0 auto 8px;border:0;border-radius:12px;" />
            <div style="font-family:${patchFont};font-size:12px;color:${P.accentOnDark};letter-spacing:3px;text-transform:uppercase;">
              Still Louder
            </div>
          </td>
        </tr>
        <tr><td style="height:5px;background:${P.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        ${imageHtml}
        <tr>
          <td style="padding:26px 24px 18px;">
            <p style="margin:0 0 16px;font-family:${serifFont};font-size:19px;color:#15121c;">${escapeHtml(greeting)}</p>
            ${bodyHtml}
            ${ctaHtml}
          </td>
        </tr>
        <tr>
          <td style="background:${P.header};padding:20px 24px;text-align:center;">
            <div style="font-size:12px;color:${P.footerText};line-height:1.6;">
              ${escapeHtml(reasonLine(r.consentSource))}
              Si no quieres recibir más noticias,
              <a href="${unsubscribeHref}" target="_blank" rel="noopener noreferrer" style="color:${P.accentOnDark};text-decoration:underline;">date de baja aquí</a>.
              Tus entradas y comprobantes siguen llegando normal.
            </div>
            ${replyLine ? `<div style="font-size:12px;color:${P.footerMuted};line-height:1.6;margin-top:8px;">${replyLine}</div>` : ''}
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

    const text = [
      greeting,
      '',
      bodyText,
      ...(ctaUrl ? ['', `${c.cta_label}: ${ctaUrl}`] : []),
      '',
      '—',
      'Still Louder',
      '',
      `${reasonLine(r.consentSource)} Si no quieres recibir más noticias, date de baja aquí: ${r.unsubscribeUrl}`,
      'Tus entradas y comprobantes siguen llegando normal.',
      ...(replyLine ? [replyLine] : [])
    ].join('\n');

    return { html, text };
  };
}
