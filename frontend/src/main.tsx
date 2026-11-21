// --- FILE: frontend/src/main.tsx ---
// Точка входа клиента: подключает стили, ставит фон страницы до первой отрисовки, регистрирует установку на телефон
// и рисует приложение (App) внутри маршрутизатора.

// Первым: перенос настроек со старого названия платформы (michess_… → regence_…) до модулей, читающих настройки.
import './migrateStorage'
import { initSentry } from './services/sentry'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { applyPageBackground } from './config/pageBackground'
import { initPwa } from './services/pwa'
import { installClientErrorReporting } from './services/clientErrors'

// Фон страницы (таск 18.1) — до первой отрисовки, чтобы не мигал.
applyPageBackground()
// Sentry (проект regence-web) — только при заданном VITE_SENTRY_DSN; до первой отрисовки, чтобы поймать её сбои.
initSentry()
// Отчёты об ошибках страницы и след событий для разбора «страница внезапно обновилась» (clientErrors.ts).
installClientErrorReporting()
// Установка на главный экран и офлайн-страница (таск 24.2); сервис-воркер — только в сборке.
initPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)