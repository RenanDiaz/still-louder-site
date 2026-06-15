import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Multi-page app: independent surfaces share one build.
//   /entradas  -> public buyer flow
//   /ayuda     -> public help / FAQ + contact (static, no backend)
//   /admin     -> staff back office (mark paid, stats, stage 2)
//   /validar   -> gate scanner (PWA-ish)
//   /support   -> staff customer support (read-only lookup + resend QR email)
// The root index.html just redirects to /entradas.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        entradas: resolve(__dirname, 'entradas.html'),
        ayuda: resolve(__dirname, 'ayuda.html'),
        admin: resolve(__dirname, 'admin.html'),
        validar: resolve(__dirname, 'validar.html'),
        support: resolve(__dirname, 'support.html')
      }
    }
  },
  server: {
    port: 3100
  }
});
