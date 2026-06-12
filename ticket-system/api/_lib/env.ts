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
  // them (and strips any surrounding quotes copied from the JSON) back into a
  // real PEM before signing.
  get googleWalletSaPrivateKey() {
    return optional('GOOGLE_WALLET_SA_PRIVATE_KEY');
  },
  // Suffix of the event's Passes Class id; classId = `${issuerId}.${suffix}`.
  get googleWalletClassSuffix() {
    return optional('GOOGLE_WALLET_CLASS_SUFFIX', 'wwwy3');
  }
};
