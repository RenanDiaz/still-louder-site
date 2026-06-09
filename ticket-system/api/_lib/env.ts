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
  }
};
