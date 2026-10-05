/**
 * /links (página de la bio) — spec: docs/features/bio-links.md
 * Oculta los shows vencidos (data-expires, D8) y registra click_link (D10).
 * Sin JS la página funciona igual; solo se pierde esto.
 */

import analytics from './analytics.js';

const now = Date.now();
document.querySelectorAll('[data-expires]').forEach((card) => {
  if (new Date(card.dataset.expires).getTime() < now) {
    card.hidden = true;
  }
});

document.querySelectorAll('[data-link]').forEach((link) => {
  link.addEventListener('click', () => {
    analytics.trackEvent('click_link', {
      event_category: 'links',
      event_label: link.dataset.link
    });
  });
});
