import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './teaser.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
