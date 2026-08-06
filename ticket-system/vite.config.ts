import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Multi-page app: independent surfaces share one build.
//   /entradas  -> public buyer flow (hoy: archivo del show pasado, WWWY3)
//   /31-10     -> teaser estático del próximo show (31 oct 2026), sin backend
//   /ayuda     -> public help / FAQ + contact (static, no backend)
//   /admin     -> staff back office (mark paid, stats, stage 2)
//   /validar   -> gate scanner (PWA-ish)
//   /support   -> staff customer support (read-only lookup + resend QR email)
//   /regalo    -> hidden gift-claim form, reached only via a campaign QR token
// The root index.html just redirects to /entradas.
//
// El nombre del archivo ES el path (cleanUrls): 31-10.html se sirve en /31-10 y
// en ningún otro lado. Es a propósito — mientras el teaser sea lo único que hay,
// el show nuevo tiene UN solo enlace público. Su slug definitivo se agregará
// como rewrite en vercel.json cuando el evento tenga nombre.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        entradas: resolve(__dirname, 'entradas.html'),
        teaser: resolve(__dirname, '31-10.html'),
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
