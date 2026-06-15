// Centralized, validated access to server-side environment variables.
// Throwing here (rather than reading process.env inline) means a missing
// secret fails loudly at the edge instead of silently producing broken
// tokens or unauthenticated requests.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL');
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get resendApiKey() {
    return required('RESEND_API_KEY');
  },
  get emailFrom() {
    return optional('EMAIL_FROM', 'Still Louder <entradas@stilllouder.space>');
  },
  // Dirección que recibe las respuestas del comprador (header Reply-To).
  // El dominio en Resend solo está verificado para ENVIAR: sin esto, responder
  // al correo de entradas no llega a nadie. Opcional: si no se configura, el
  // correo no invita a responder y solo menciona los canales oficiales.
  get emailReplyTo() {
    return optional('EMAIL_REPLY_TO');
  },
  // Destinatario(s) interno(s) que reciben aviso cuando se registra una compra.
  // Opcional: si no se configura, no se envía el aviso (feature opt-in).
  // Acepta varias direcciones separadas por coma.
  get orderNotificationEmail() {
    return optional('ORDER_NOTIFICATION_EMAIL');
  },
  get ticketHmacSecret() {
    return required('TICKET_HMAC_SECRET');
  },
  get adminPassword() {
    return required('ADMIN_PASSWORD');
  },
  get staffPassword() {
    return required('STAFF_PASSWORD');
  },
  // Customer-support role: read-only lookup + resend QR email. Optional and
  // opt-in — when unset, only ADMIN_PASSWORD can reach the /support surface.
  get supportPassword() {
    return optional('SUPPORT_PASSWORD');
  },
  get cronSecret() {
    return optional('CRON_SECRET');
  },
  get publicBaseUrl() {
    return optional('PUBLIC_BASE_URL', 'https://entradas.stilllouder.space');
  },

  // --- Yappy Botón de Pago V2 (server-only; never reaches the client) --------
  get yappyBtnMerchantId() {
    return required('YAPPY_BTN_MERCHANT_ID');
  },
  // Base64 string exactly as issued by the Yappy portal (shown only once).
  get yappyBtnSecretKey() {
    return required('YAPPY_BTN_SECRET_KEY');
  },
  // Must match the URL configured in the Yappy merchant portal.
  get yappyBtnDomain() {
    return optional('YAPPY_BTN_DOMAIN', this.publicBaseUrl);
  },
  get yappyBtnEnv() {
    return optional('YAPPY_BTN_ENV', 'test');
  },

  // --- Yappy transactional API (reversals; server-only) ----------------------
  // SEPARATE credentials from Botón de Pago V2 — used to reverse a same-day
  // charge via PUT /v1/transaction/{id}. All optional in practice: when unset,
  // the refund button falls back to a manual mark (no API call), so these
  // getters are only read after isYappyRefundConfigured() confirms they exist.
  // `channel` defaults to a placeholder — confirm the real value with Yappy
  // support (botondepagoyappy@bgeneral.com).
  get yappyApiKey() {
    return required('YAPPY_API_KEY');
  },
  get yappyApiSecretKey() {
    return required('YAPPY_API_SECRET_KEY');
  },
  get yappyApiAuthorization() {
    return required('YAPPY_API_AUTHORIZATION');
  },
  get yappyApiChannel() {
    return optional('YAPPY_API_CHANNEL', 'API');
  },

  // --- Google Wallet (server-only; signs the save-to-wallet JWT) -------------
  // All four are optional: the feature is opt-in (fase 3). When the issuer id,
  // service-account email or private key is missing, the "Add to Google Wallet"
  // button simply never renders and no Wallet API calls are made — the presale
  // is never blocked by this.
  get googleWalletIssuerId() {
    return optional('GOOGLE_WALLET_ISSUER_ID');
  },
  // client_email from the service-account JSON.
  get googleWalletSaEmail() {
    return optional('GOOGLE_WALLET_SA_EMAIL');
  },
  // private_key from the service-account JSON. Vercel env values keep the
  // newlines escaped as the two characters "\n"; google-wallet.ts un-escapes
  // them back into a real PEM before signing.
  get googleWalletSaPrivateKey() {
    return optional('GOOGLE_WALLET_SA_PRIVATE_KEY');
  },
  // Suffix of the event's Passes Class id; classId = `${issuerId}.${suffix}`.
  get googleWalletClassSuffix() {
    return optional('GOOGLE_WALLET_CLASS_SUFFIX', 'wwwy3');
  }
};
