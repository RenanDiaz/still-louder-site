import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from '../shared/analytics';
// Both views ship in one bundle; html[data-view] / html[data-theme] (set by
// App from the event) decide which rules apply — see each file's header.
import './theme.css';
import './themes/mono.css';
import './themes/halloween.css';
import './teaser.css';

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
