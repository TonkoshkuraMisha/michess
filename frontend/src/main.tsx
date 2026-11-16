// --- FILE: frontend/src/main.tsx ---

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { applyPageBackground } from './config/pageBackground'
import { initPwa } from './services/pwa'

// Фон страницы (таск 18.1) — до первой отрисовки, чтобы не мигал.
applyPageBackground()
// Установка на главный экран и офлайн-страница (таск 24.2); сервис-воркер — только в сборке.
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)