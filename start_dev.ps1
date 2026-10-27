# --- FILE: start_dev.ps1 ---

Write-Host "1/3 Запуск инфраструктуры (Docker: PostgreSQL + Redis)..." -ForegroundColor Cyan
docker compose up -d db redis

Write-Host "2/3 Запуск FastAPI Backend в новом окне..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; .\michess_env\Scripts\Activate.ps1; python -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload"

Write-Host "3/3 Запуск React/Vite Frontend в новом окне..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev"

Write-Host "Готово! Фронтенд: http://localhost:5173 | API Docs: http://127.0.0.1:8000/docs" -ForegroundColor Magenta