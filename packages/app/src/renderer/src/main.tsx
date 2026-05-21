import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('renderer: #root not found');

// Warm the Nerd Font so terminal glyphs are ready by the time a terminal opens.
void document.fonts.load('13px "Symbols Nerd Font Mono"');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
