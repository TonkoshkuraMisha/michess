// --- FILE: frontend/src/main.tsx ---

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { applyPageBackground } from './config/pageBackground'

// Фон страницы (таск 18.1) — до первой отрисовки, чтобы не мигал.
applyPageBackground()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)