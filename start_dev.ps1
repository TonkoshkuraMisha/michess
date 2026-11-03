# --- FILE: start_dev.ps1 ---
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$pythonExe = Join-Path $root "michess_env\Scripts\python.exe"
$frontendDir = Join-Path $root "frontend"

Write-Host "=== Запуск среды разработки Michess ===" -ForegroundColor Cyan

# 1. Автопроверка и создание виртуального окружения Python на любой машине
if (-not (Test-Path $pythonExe))
{
    Write-Host "[*] Создаем виртуальное окружение Python (michess_env)..." -ForegroundColor Yellow
    python -m venv (Join-Path $root "michess_env")
    & $pythonExe -m pip install --upgrade pip
    & $pythonExe -m pip install -r (Join-Path $root "requirements.txt")
}

# 2. Автопроверка node_modules во фронтенде
if (-not (Test-Path (Join-Path $frontendDir "node_modules")))
{
    Write-Host "[*] Устанавливаем npm-зависимости фронтенда..." -ForegroundColor Yellow
    Set-Location $frontendDir
    npm install
    Set-Location $root
}

# 3. Поднятие базы данных и Redis через Docker
Write-Host "[*] Проверяем Docker и контейнеры (PostgreSQL, Redis)..." -ForegroundColor Cyan
docker compose up -d db redis
if ($LASTEXITCODE -ne 0)
{
    Write-Host "[!] Внимание: Docker Desktop не запущен или недоступен!" -ForegroundColor Red
}

# 4. Применение миграций БД
Write-Host "[*] Применяем миграции базы данных (Alembic)..." -ForegroundColor Cyan
& $pythonExe -m alembic upgrade head

# 5. Запуск серверов в фоновых задачах PowerShell (работает одинаково на ноутах и ПК)
Write-Host "[+] Запуск FastAPI Backend (порт 8000)..." -ForegroundColor Green
Start-Job -Name "MichessBackend" -ScriptBlock {
    param($py, $r)
    Set-Location $r
    & $py -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
} -ArgumentList $pythonExe, $root | Out-Null

Write-Host "[+] Запуск Vite Frontend (порт 3000)..." -ForegroundColor Green
Start-Job -Name "MichessFrontend" -ScriptBlock {
    param($fe)
    Set-Location $fe
    npm run dev -- --host 127.0.0.1 --port 3000 --strictPort
} -ArgumentList $frontendDir | Out-Null

Start-Sleep -Seconds 2
Write-Host "[+] Открываем браузер на http://127.0.0.1:3000 ..." -ForegroundColor Magenta
Start-Process "http://127.0.0.1:3000"

Write-Host "========================================================" -ForegroundColor Green
Write-Host " Все сервисы запущены! Локальный сервер работает." -ForegroundColor Green
Write-Host " Фронтенд: http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host " API Docs: http://127.0.0.1:8000/docs" -ForegroundColor Cyan
Write-Host " Для остановки фоновых задач выполните: Get-Job | Stop-Job; Remove-Job" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Green