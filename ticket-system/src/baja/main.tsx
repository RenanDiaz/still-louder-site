import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Tema público de /entradas (como /ayuda y /regalo). Sin initAnalytics(): esta
// página no carga GA4 (docs/features/campanas-promocion.md).
import '../entradas/theme.css';
import '../entradas/themes/mono.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
