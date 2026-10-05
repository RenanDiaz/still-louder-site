/**
 * Centralized Configuration
 * All external URLs, constants, and configuration values in one place
 */

export const CONFIG = {
  // Streaming Platform Links
  platforms: {
    spotify: {
      name: 'Spotify',
      url: 'https://open.spotify.com/track/7jc86BEyQt8sdJsEbqtllU?si=1c59b85003e84b02',
      icon: 'spotify',
      color: '#1db954'
    },
    appleMusic: {
      name: 'Apple Music',
      url: 'https://music.apple.com/pa/album/skirlaz/1871380684?i=1871380685&l=en-GB',
      icon: 'apple-music',
      color: '#fa243c'
    },
    youtube: {
      name: 'YouTube',
      url: 'https://www.youtube.com/@StillLouder',
      icon: 'youtube',
      color: '#ff0000'
    },
    deezer: {
      name: 'Deezer',
      url: 'https://link.deezer.com/s/33uBZiHm7eOvA8b5tzklb',
      icon: 'deezer',
      color: '#ff0092'
    },
    amazonMusic: {
      name: 'Amazon Music',
      url: 'https://music.amazon.com/tracks/B0GJ7DHTMV?marketplaceId=ATVPDKIKX0DER&musicTerritory=US&ref=dm_sh_fJNxSrdaEGv6WxGuYZQFb117Y',
      icon: 'amazon-music',
      color: '#232f3e'
    }
  },

  // Social Media Links
  social: {
    instagram: {
      name: 'Instagram',
      url: 'https://www.instagram.com/still_louder/',
      handle: '@still_louder'
    },
    facebook: {
      name: 'Facebook',
      url: 'https://www.facebook.com/share/1FRfEeLhhp/?mibextid=wwXIfr',
      handle: 'stilllouder'
    },
    youtube: {
      name: 'YouTube',
      url: 'https://www.youtube.com/@StillLouder',
      handle: '@StillLouder'
    },
    tiktok: {
      name: 'TikTok',
      url: 'https://www.tiktok.com/@stilllouder.pa',
      handle: '@stilllouder.pa'
    }
  },

  // Store / Merchandise (Cuanto App)
  store: {
    name: 'Tienda Oficial',
    url: 'https://cuanto.app/still_louder',
    platform: 'Cuanto'
  },

  // Shows / fechas en vivo. Cada fecha próxima tiene su tarjeta en #shows de
  // index.html (el HTML es la fuente del copy; aquí viven las URLs y fechas).
  // Orden cronológico: la primera es la "próxima fecha".
  shows: {
    upcoming: {
      // 11 oct: teloneros de Stratovarius en su debut en Panamá. La venta NO es
      // nuestra — la lleva Ticketplus (productora: The Eclectic Agency /
      // CK Concerts), así que el CTA sale del sitio.
      stratovarius: {
        name: 'Stratovarius en Panamá',
        dateISO: '2026-10-11T20:00:00-05:00',
        dateLabel: '11 · 10 · 2026',
        venue: 'Aurora at Soho',
        city: 'Ciudad de Panamá',
        ticketsVendor: 'Ticketplus',
        ticketsUrl: 'https://ventas.ticketpluspty.com/event/stratovarius-xg5o64'
      },
      // 31 oct: fecha propia, venta directa en el ticket-system (evento
      // `halloween-party`, ver docs/features/entradas-31-10.md). Preventa $10 (primeras
      // 100) desde el 1 oct a las 00:00; general $12.
      oct31: {
        name: "Still Louder's Halloween Party",
        guests: 'Fábula Sarcástica & Elefreak',
        dateISO: '2026-10-31T20:00:00-05:00',
        dateLabel: '31 · 10 · 2026',
        venue: 'Hops Food & Drinks',
        city: 'David, Chiriquí',
        presaleStartISO: '2026-10-01T00:00:00-05:00',
        ticketsUrl: 'https://entradas.still-louder.com/halloween-party'
      }
    },
    // Canal donde se anuncian las fechas (destino del CTA mientras no hay venta).
    announceUrl: 'https://www.instagram.com/still_louder/',
    // Página de ayuda del sistema de entradas (FAQ del evento actual + canales).
    helpUrl: 'https://entradas.still-louder.com/ayuda'
  },

  // Analytics Configuration
  analytics: {
    id: 'G-ZZ4XG8CD88',
    enabled: true
  },

  // Release Information
  release: {
    title: 'A Las 10',
    artist: 'Still Louder',
    releaseDate: '2026-10-05',
    genre: 'Rock',
    coverImage: '/images/album_covers/a-las-10.jpeg',
    video: null
  },

  // Site Information
  site: {
    name: 'Still Louder',
    url: 'https://still-louder.com/',
    description:
      '¡Ya disponible! Escucha "A Las 10", el nuevo sencillo de Still Louder, en todas las plataformas digitales.',
    locale: 'es_PA',
    themeColor: '#140505'
  },

  // Comments Form (Google Forms)
  comments: {
    formUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSe8YfvuBNMBNjpclU3-0d0O_N5429TlJ4QWPpLwv_o0uh8n0A/formResponse',
    nameField: 'entry.1365306044',
    commentField: 'entry.1365306044'
  },

  // Contact / Booking form — backend-less, submitted to a Google Form.
  // The existing Google Form has a SINGLE text field, so we compose the
  // visitor's name + email + message into that one field (messageField).
  // To switch to a dedicated form with separate columns, create a new Google
  // Form, then replace formUrl + messageField here (or add name/email fields).
  // NOTE: docs.google.com must be allowed in `connect-src` (vercel.json CSP),
  // since the submit is a `fetch(..., { mode: 'no-cors' })`.
  contact: {
    formUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSe8YfvuBNMBNjpclU3-0d0O_N5429TlJ4QWPpLwv_o0uh8n0A/formResponse',
    messageField: 'entry.1365306044',
    // Optional booking email rendered as a mailto. Leave null to show only the
    // form + Instagram DM as the human channel.
    bookingEmail: null
  },

  // Sponsors
  sponsors: [
    {
      name: 'Ron Abuelo',
      logo: 'assets/images/sponsors/ron-abuelo-white.jpeg',
      url: null
    },
    {
      name: 'Seco Herrerano',
      logo: 'assets/images/sponsors/seco-herrerano-full-white.jpeg',
      url: null
    },
    {
      name: 'Full Drop',
      logo: 'assets/images/sponsors/full-drop.jpeg',
      url: null
    },
    {
      name: 'Smart Clean',
      logo: 'assets/images/sponsors/smart-clean.jpeg',
      url: null
    }
  ],

  // Feature Flags
  features: {
    shareButton: true,
    webShareAPI: true,
    offlineSupport: false, // PWA not yet implemented
    comments: true,
    contact: true,
    sponsors: true
  },

  // UI Configuration
  ui: {
    animationDuration: 300,
    carouselInterval: 3000,
    toastDuration: 3000,
    loadingDelay: 300
  },

  // Error Messages
  messages: {
    error: {
      generic: 'Ocurrió un error. Por favor, intenta de nuevo.',
      network: 'No hay conexión a internet. Verifica tu conexión.',
      commentEmpty: 'Por favor, escribe un comentario antes de enviar.',
      commentFailed: 'Ocurrió un error al enviar. Intenta de nuevo.',
      contactIncomplete: 'Completa tu nombre, correo y mensaje antes de enviar.',
      contactInvalidEmail: 'Revisa tu correo: parece inválido.',
      contactFailed: 'No se pudo enviar tu mensaje. Intenta de nuevo.',
      shareFailed: 'No se pudo compartir el contenido.'
    },
    success: {
      commentSent: '¡Gracias por tu comentario!',
      contactSent: '¡Mensaje enviado! Te responderemos pronto.',
      shareSuccess: '¡Contenido compartido exitosamente!',
      copiedToClipboard: '¡Enlace copiado al portapapeles!'
    }
  }
};

// Freeze config to prevent accidental modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.platforms);
Object.freeze(CONFIG.social);
Object.freeze(CONFIG.analytics);
Object.freeze(CONFIG.release);
Object.freeze(CONFIG.site);
Object.freeze(CONFIG.comments);
Object.freeze(CONFIG.contact);
Object.freeze(CONFIG.features);
Object.freeze(CONFIG.ui);
Object.freeze(CONFIG.messages);
Object.freeze(CONFIG.store);
Object.freeze(CONFIG.shows);
Object.freeze(CONFIG.shows.upcoming);
Object.freeze(CONFIG.shows.upcoming.stratovarius);
Object.freeze(CONFIG.shows.upcoming.oct31);

export default CONFIG;
