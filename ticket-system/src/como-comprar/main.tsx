import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from '../shared/analytics';
// La cara pública comparte la identidad visual del flujo de compra: importamos
// el mismo tema que /entradas y los estilos de /ayuda (tarjetas de papel).
import '../entradas/theme.css';
import '../entradas/themes/mono.css';
import '../entradas/themes/halloween.css';
import '../ayuda/ayuda.css';
import './como-comprar.css';

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
