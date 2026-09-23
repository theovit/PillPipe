import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted (no Google Fonts CDN — see docs/TODO.md security headers item); weights match what
// index.html used to load: IBM Plex Mono 400/500, IBM Plex Sans 400/500/600/700.
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
