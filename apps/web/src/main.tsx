import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { consoleBanner, listenKonami } from './lib/easterEggs'
import './styles.css'

consoleBanner()
listenKonami()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
