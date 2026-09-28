import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Multi-page app: independent surfaces share one build.
//   /entradas  -> public buyer flow for ANY event (slug from the path or
//                 ?evento=; none = the server's "current" event). The event's
//                 status picks the view (teaser / countdown / form / archive).
//   /31-10     -> same app as /entradas (src/entradas/main.tsx); the file only
//                 exists so the link preview carries the show's own meta tags
//   /ayuda     -> public help / FAQ + contact (static, no backend)
//   /admin     -> staff back office (mark paid, stats, stage 2)
//   /validar   -> gate scanner (PWA-ish)
//   /support   -> staff customer support (read-only lookup + resend QR email)
//   /regalo    -> hidden gift-claim form, reached only via a campaign QR token
// The root index.html just redirects to /entradas.
//
// Other event slugs reach the same app via rewrites (vercel.json +
// public/_redirects, e.g. /when-we-were-young-3 -> /entradas) or, with no
// redeploy at all, via /entradas?evento=<slug>.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        entradas: resolve(__dirname, 'entradas.html'),
        show3110: resolve(__dirname, '31-10.html'),
        ayuda: resolve(__dirname, 'ayuda.html'),
        admin: resolve(__dirname, 'admin.html'),
        validar: resolve(__dirname, 'validar.html'),
        support: resolve(__dirname, 'support.html'),
        regalo: resolve(__dirname, 'regalo.html')
      }
    }
  },
  server: {
    port: 3100
  }
});
