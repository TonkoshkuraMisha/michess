# --- FILE: start_dev.ps1 ---

$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$pythonExe = Join-Path $root "michess_env\Scripts\python.exe"
$frontendDir = Join-Path $root "frontend"
$stockfishBin = Join-Path $root "bin\stockfish.exe"

Write-Host "=== Запуск среды разработки Michess ===" -ForegroundColor Cyan

# 1. Автосоздание .env файлов из шаблонов, если их ещё нет на этой машине
if (-not (Test-Path (Join-Path $root ".env")) -and (Test-Path (Join-Path $root ".env.example")))
{
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
    Write-Host "[+] Создан корневой .env из .env.example" -ForegroundColor Green
}
if (-not (Test-Path (Join-Path $frontendDir ".env")) -and (Test-Path (Join-Path $frontendDir ".env.example")))
{
    Copy-Item (Join-Path $frontendDir ".env.example") (Join-Path $frontendDir ".env")
    Write-Host "[+] Создан frontend/.env из шаблона" -ForegroundColor Green
}

# 2. Остановка старых фоновых задач и освобождение портов 8000 и 3000
Get-Job -Name "MichessBackend", "MichessFrontend" -ErrorAction SilentlyContinue | Stop-Job -PassThru | Remove-Job -Force -ErrorAction SilentlyContinue

foreach ($port in @(8000, 3000))
{
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conns)
    {
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids)
        {
            if ($procId -gt 0)
            {
                Write-Host "[*] Освобождаем порт $port (PID: $procId)..." -ForegroundColor DarkYellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# 3. Автопроверка и создание виртуального окружения Python на любой машине
if (-not (Test-Path $pythonExe))
{
    Write-Host "[*] Создаем виртуальное окружение Python (michess_env)..." -ForegroundColor Yellow
    python -m venv (Join-Path $root "michess_env")
    & $pythonExe -m pip install --upgrade pip
    & $pythonExe -m pip install -r (Join-Path $root "requirements.txt")
}

# 4. Автопроверка и скачивание движка Stockfish 19
if (-not (Test-Path $stockfishBin))
{
    Write-Host "[*] Бинарник Stockfish не найден в bin/. Скачиваем..." -ForegroundColor Yellow
    & $pythonExe (Join-Path $root "scripts\setup_stockfish.py")
}

# 5. Автопроверка node_modules во фронтенде
if (-not (Test-Path (Join-Path $frontendDir "node_modules")))
{
    Write-Host "[*] Устанавливаем npm-зависимости фронтенда..." -ForegroundColor Yellow
    Set-Location $frontendDir
    npm install
    Set-Location $root
}

# 6. Поднятие базы данных и Redis через Docker
Write-Host "[*] Проверяем Docker и контейнеры (PostgreSQL: 15432, Redis: 6379)..." -ForegroundColor Cyan
docker compose up -d db redis
if ($LASTEXITCODE -ne 0)
{
    Write-Host "[!] Внимание: Docker Desktop не запущен или недоступен!" -ForegroundColor Red
}

# 7. Применение миграций БД
Write-Host "[*] Применяем миграции базы данных (Alembic)..." -ForegroundColor Cyan
& $pythonExe -m alembic upgrade head

# 8. Запуск серверов в фоновых задачах PowerShell (работает одинаково на ноутбуке и ПК)
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

# 9. Ожидание фактического открытия порта 3000 перед запуском браузера
$ready = $false
for ($i = 0; $i -lt 30; $i++)
{
    if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    {
        $ready = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

if ($ready)
{
    Write-Host "[+] Открываем браузер на [http://127.0.0.1:3000](http://127.0.0.1:3000) ..." -ForegroundColor Magenta
Start-Process "http://127.0.0.1:3000"
}
else
{
    Write-Host "[!] Порт 3000 не ответил за 15 секунд. Проверьте лог: Receive-Job -Name MichessFrontend -Keep" -ForegroundColor Red
}

Write-Host "========================================================" -ForegroundColor Green
Write-Host " Все сервисы запущены! Локальный сервер работает." -ForegroundColor Green
Write-Host " Фронтенд: [http://127.0.0.1:3000](http://127.0.0.1:3000)" -ForegroundColor Cyan
Write-Host " API Docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)" -ForegroundColor Cyan
Write-Host " Просмотр логов: Receive-Job -Name MichessBackend -Keep" -ForegroundColor Gray
Write-Host " Для остановки:  Get-Job | Stop-Job; Get-Job | Remove-Job" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Green