import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Both views ship in one bundle; html[data-view] / html[data-theme] (set by
// App from the event) decide which rules apply — see each file's header.
import './theme.css';
import './themes/mono.css';
import './teaser.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
