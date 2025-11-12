/**
 * Centralized Configuration
 * All external URLs, constants, and configuration values in one place
 */

export const CONFIG = {
  // Streaming Platform Links
  platforms: {
    spotify: {
      name: 'Spotify',
      url: 'https://open.spotify.com/track/4zBlVazxK6AQBMPZl9Rcgj?si=a96b91e05196497f',
      icon: 'spotify',
      color: '#1db954'
    },
    appleMusic: {
      name: 'Apple Music',
      url: 'https://music.apple.com/pa/album/al-vac%C3%ADo/1829334537?i=1829334538',
      icon: 'apple-music',
      color: '#fa243c'
    },
    youtube: {
      name: 'YouTube',
      url: 'https://youtu.be/L1JoCgyumzY?si=vdopuSJKVCdSvT9y',
      icon: 'youtube',
      color: '#ff0000'
    },
    deezer: {
      name: 'Deezer',
      url: 'https://link.deezer.com/s/30BAvwIohgJLbpIWKmFld',
      icon: 'deezer',
      color: '#ff0092'
    },
    amazonMusic: {
      name: 'Amazon Music',
      url: 'https://music.amazon.com/tracks/B0FK3D2CK6',
      icon: 'amazon-music',
      color: '#232f3e'
    }
  },

  // Social Media Links
  social: {
    instagram: {
      name: 'Instagram',
      url: 'https://www.instagram.com/stilllouder/',
      handle: '@stilllouder'
    },
    facebook: {
      name: 'Facebook',
      url: 'https://www.facebook.com/stilllouder/',
      handle: 'stilllouder'
    },
    youtube: {
      name: 'YouTube',
      url: 'https://www.youtube.com/@StillLouder',
      handle: '@StillLouder'
    }
  },

  // Analytics Configuration
  analytics: {
    id: 'G-ZZ4XG8CD88',
    enabled: true
  },

  // Release Information
  release: {
    title: 'Al Vacío',
    artist: 'Still Louder',
    releaseDate: '2025-07-28',
    genre: 'Rock',
    coverImage: 'https://i.imgur.com/CoA13WN.jpg',
    audioFile: 'assets/Still Louder - Al Vacío.mp3'
  },

  // Site Information
  site: {
    name: 'Still Louder',
    url: 'https://stillouder.space/',
    description: '¡Ya disponible! Escucha "Al Vacío", el nuevo sencillo de Still Louder, en todas las plataformas digitales.',
    locale: 'es_PA',
    themeColor: '#000000'
  },

  // Comments Form (Google Forms)
  comments: {
    formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSe8YfvuBNMBNjpclU3-0d0O_N5429TlJ4QWPpLwv_o0uh8n0A/formResponse',
    nameField: 'entry.1365306044',
    commentField: 'entry.1365306044'
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
      shareFailed: 'No se pudo compartir el contenido.'
    },
    success: {
      commentSent: '¡Gracias por tu comentario!',
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
Object.freeze(CONFIG.features);
Object.freeze(CONFIG.ui);
Object.freeze(CONFIG.messages);

export default CONFIG;
