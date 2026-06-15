import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// La cara pública comparte la identidad visual del flujo de compra: importamos
// el mismo tema que /entradas y le sumamos los estilos propios del FAQ.
import '../entradas/theme.css';
import './ayuda.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
