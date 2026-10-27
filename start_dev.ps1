# --- FILE: start_dev.ps1 ---

$ErrorActionPreference = "Stop"

# Выбираем PowerShell 7 (pwsh), если установлен, иначе стандартный Windows PowerShell
$psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue)
{
    "pwsh"
}
else
{
    "powershell"
}

# Функция освобождения порта от зависших процессов предыдущего запуска
function Stop-PortProcess([int]$Port)
{
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connections)
    {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids)
        {
            if ($procId -gt 0)
            {
                Write-Host "Освобождаем порт $Port (PID: $procId)..." -ForegroundColor DarkYellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "1/4 Очистка портов разработки (8000 и 3000)..." -ForegroundColor Cyan
Stop-PortProcess 8000
Stop-PortProcess 3000

Write-Host "2/4 Проверка инфраструктуры (PostgreSQL: 15432, Redis: 6379)..." -ForegroundColor Cyan
$dbRunning = Get-NetTCPConnection -LocalPort 15432 -State Listen -ErrorAction SilentlyContinue
$redisRunning = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue

if ($dbRunning -and $redisRunning)
{
    Write-Host "PostgreSQL (15432) и Redis (6379) уже запущены — пропускаем старт контейнеров." -ForegroundColor Green
}
else
{
    Write-Host "Запускаем недостающие контейнеры через Docker Compose..." -ForegroundColor Yellow
    docker compose up -d db redis
}

Write-Host "3/4 Запуск FastAPI Backend в новом окне (http://127.0.0.1:8000)..." -ForegroundColor Green
$backendCmd = "Set-Location '$PSScriptRoot'; .\michess_env\Scripts\Activate.ps1; alembic upgrade head; python -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload"
Start-Process $psExe -ArgumentList "-NoExit", "-Command", $backendCmd

Write-Host "4/4 Запуск React/Vite Frontend в новом окне (http://127.0.0.1:3000)..." -ForegroundColor Yellow
$frontendCmd = "Set-Location '$PSScriptRoot\frontend'; npm run dev"
Start-Process $psExe -ArgumentList "-NoExit", "-Command", $frontendCmd

Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:3000"

Write-Host "Готово! Фронтенд: http://127.0.0.1:3000 | API Docs: http://127.0.0.1:8000/docs" -ForegroundColor Magenta