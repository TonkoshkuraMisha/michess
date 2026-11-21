# --- FILE: start_dev.ps1 ---

$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$pythonExe = Join-Path $root ".venv\Scripts\python.exe"
$frontendDir = Join-Path $root "frontend"
$stockfishBin = Join-Path $root "bin\stockfish.exe"

Write-Host "=== Запуск среды разработки Regence ===" -ForegroundColor Cyan

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

# 2. Остановка старых фоновых задач, процессов node и освобождение портов 8000 и 3000
Get-Job -Name "RegenceBackend", "RegenceWorker", "RegenceFrontend" -ErrorAction SilentlyContinue | Stop-Job -PassThru | Remove-Job -Force -ErrorAction SilentlyContinue

# Процессы, оставшиеся от прошлых запусков из ДРУГИХ окон (Get-Job видит задания только своей сессии):
# Celery-воркер этого проекта (порта у него нет) и Vite из папки frontend. Чужие процессы node
# (например, сам Claude Code или другие проекты) не трогаем — только те, чья командная строка указывает сюда.
$stale = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and (
        ($_.Name -like "python*" -and $_.CommandLine -like "*celery*src.worker.celery_app*") -or
        ($_.Name -eq "node.exe" -and $_.CommandLine -like "*$frontendDir*vite*")
    )
}
foreach ($p in $stale)
{
    Write-Host "[*] Останавливаем старый процесс $( $p.Name ) (PID: $( $p.ProcessId ))..." -ForegroundColor DarkYellow
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

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
    Write-Host "[*] Создаем окружение Python (.venv) через uv..." -ForegroundColor Yellow
    if (-not (Get-Command uv -ErrorAction SilentlyContinue))
    {
        Write-Host "[!] uv не найден. Установка: powershell -ExecutionPolicy ByPass -c ""irm https://astral.sh/uv/install.ps1 | iex""" -ForegroundColor Red
        exit 1
    }
    Push-Location $root
    & uv sync --frozen
    Pop-Location
}

# 4. Автопроверка и скачивание движка Stockfish 19
if (-not (Test-Path $stockfishBin))
{
    Write-Host "[*] Бинарник Stockfish не найден в bin/. Скачиваем..." -ForegroundColor Yellow
    & $pythonExe (Join-Path $root "scripts\setup_stockfish.py")
}

# 4.1. Поиск Node.js. Терминал PyCharm может унаследовать PATH без папки Node.js (IDE запущена до установки Node
# или со старым окружением) — тогда ищем в стандартных местах и добавляем папку в PATH этого процесса и дочерних окон.
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd)
{
    $npmCmd = @(
        (Join-Path $env:ProgramFiles "nodejs\npm.cmd"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\npm.cmd"),
        (Join-Path $env:APPDATA "nvm\nodejs\npm.cmd"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.cmd")
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $npmCmd)
{
    Write-Host "[!] Node.js (npm.cmd) не найден. Установите Node.js LTS и перезапустите PyCharm." -ForegroundColor Red
    exit 1
}
$nodeDir = Split-Path $npmCmd -Parent
if (($env:Path -split ";") -notcontains $nodeDir)
{
    $env:Path = "$nodeDir;$env:Path"
}

# 5. Автопроверка node_modules во фронтенде
if (-not (Test-Path (Join-Path $frontendDir "node_modules")))
{
    Write-Host "[*] Устанавливаем npm-зависимости фронтенда..." -ForegroundColor Yellow
    Set-Location $frontendDir
    # npm.cmd, а не npm: обёртка npm.ps1 не запускается при запрете скриптов (политика выполнения по умолчанию).
    & $npmCmd install
    Set-Location $root
}

# 6. Поднятие базы данных и Redis через Docker
Write-Host "[*] Проверяем Docker и контейнеры (PostgreSQL: 15432, Redis: 6379)..." -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue))
{
    Write-Host "[!] Команда docker не найдена. Установите Docker Desktop и запустите скрипт снова." -ForegroundColor Red
    exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0)
{
    $dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerDesktop)
    {
        Write-Host "[*] Docker Desktop не запущен — запускаем и ждём (до 120 с)..." -ForegroundColor Yellow
        Start-Process $dockerDesktop
        for ($i = 0; $i -lt 60; $i++)
        {
            Start-Sleep -Seconds 2
            docker info *> $null
            if ($LASTEXITCODE -eq 0) { break }
        }
    }
    if ($LASTEXITCODE -ne 0)
    {
        Write-Host "[!] Docker недоступен. Запустите Docker Desktop, дождитесь статуса 'Engine running' и повторите." -ForegroundColor Red
        exit 1
    }
}
docker compose up -d db redis
if ($LASTEXITCODE -ne 0)
{
    Write-Host "[!] Не удалось поднять контейнеры db и redis (docker compose up). Запуск прерван." -ForegroundColor Red
    exit 1
}

# 6.1. Ожидание готовности PostgreSQL: порт контейнера открывается раньше, чем база принимает подключения
$dbReady = $false
for ($i = 0; $i -lt 30; $i++)
{
    docker compose exec -T db pg_isready *> $null
    if ($LASTEXITCODE -eq 0)
    {
        $dbReady = $true
        break
    }
    Start-Sleep -Seconds 1
}
if (-not $dbReady)
{
    Write-Host "[!] PostgreSQL не стал принимать подключения за 30 секунд. Смотрите: docker compose logs db" -ForegroundColor Red
    exit 1
}

# 7. Применение миграций БД
Write-Host "[*] Применяем миграции базы данных (Alembic)..." -ForegroundColor Cyan
& $pythonExe -m alembic upgrade head
if ($LASTEXITCODE -ne 0)
{
    Write-Host "[!] Миграции Alembic завершились с ошибкой (см. вывод выше). Запуск прерван." -ForegroundColor Red
    exit 1
}

# 7.0. База задач (выборка из открытой базы lichess, data/puzzles); уже загруженные задачи пропускаются
Write-Host "[*] Загружаем базу задач..." -ForegroundColor Cyan
& $pythonExe -m scripts.import_puzzles
if ($LASTEXITCODE -ne 0)
{
    Write-Host "[!] Загрузка базы задач завершилась с ошибкой (см. вывод выше). Запуск прерван." -ForegroundColor Red
    exit 1
}

# 7.1. Автопроверка и докачка архивов партий 21 чемпиона мира
$steinitzPgn = Join-Path $root "src\db\data\pgns\Steinitz.pgn"
if (-not (Test-Path $steinitzPgn))
{
    Write-Host "[*] PGN-архивы чемпионов мира не найдены на этом ПК. Скачиваем и импортируем в БД..." -ForegroundColor Yellow
    & $pythonExe -m src.db.seed
}

# 8. Запуск FastAPI Backend в фоне
Write-Host "[+] Запуск FastAPI Backend (порт 8000)..." -ForegroundColor Green
# Журнал сервера: консоль задания не видна, поэтому json-файл с ротацией logs/api.jsonl (src/core/logging_setup.py);
# разбор — python scripts/trace_logs.py game_id=<id> logs/api.jsonl logs/worker.jsonl.
New-Item -ItemType Directory -Force -Path (Join-Path $root "logs") | Out-Null
Start-Job -Name "RegenceBackend" -ScriptBlock {
    param($py, $r)
    Set-Location $r
    $env:LOG_FILE = Join-Path $r "logs\api.jsonl"
    & $py -m uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload
} -ArgumentList $pythonExe, $root | Out-Null

# 8.0. Запуск Celery-воркера (фоновый анализ завершённых партий) в фоне.
# На Windows пул prefork у Celery не работает — используем solo (одна задача за раз).
Write-Host "[+] Запуск Celery-воркера (фоновый анализ партий)..." -ForegroundColor Green
Start-Job -Name "RegenceWorker" -ScriptBlock {
    param($py, $r)
    Set-Location $r
    $env:LOG_FILE = Join-Path $r "logs\worker.jsonl"
    # Обе очереди (analysis — разбор партий, simulation — партии ботов в турнирах) слушает один воркер.
    & $py -m celery -A src.worker.celery_app worker --loglevel=INFO --pool=solo -Q analysis,simulation
} -ArgumentList $pythonExe, $root | Out-Null

# 8.1. Запуск Vite Frontend в отдельном видимом окне терминала
Write-Host "[+] Запуск Vite Frontend (порт 3000 в новом окне)..." -ForegroundColor Green
# Окно — PowerShell 7 (pwsh), если он есть; иначе Windows PowerShell 5.1 (powershell — всегда 5.1). В 5.1 скрипты, а с
# ними обёртка npm.ps1, по умолчанию запрещены: поэтому npm.cmd и -ExecutionPolicy Bypass только для этого процесса
# (системные настройки не меняются).
$frontendShell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
# Вывод Vite дублируется в frontend/vite-dev.log (*.log в .gitignore): если окно не поднимет сервер, скрипт покажет
# хвост лога здесь, а не только в отдельном окне, которое легко потерять за другими.
$viteLog = Join-Path $frontendDir "vite-dev.log"
Remove-Item $viteLog -Force -ErrorAction SilentlyContinue
# Папку задаём через -WorkingDirectory, а не через cd внутри -Command: из терминала PyCharm окно открывалось в корне
# проекта, и npm падал с ENOENT на package.json. Путь к package.json передаём ещё и явно (--prefix) — на случай, если
# оболочка всё же сменит каталог при старте.
Start-Process $frontendShell -WorkingDirectory $frontendDir -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "`$env:Path = '$nodeDir;' + `$env:Path; Set-Location -LiteralPath '$frontendDir'; & '$npmCmd' --prefix '$frontendDir' run dev 2>&1 | Tee-Object -FilePath '$viteLog'"

# 9. Ожидание фактического открытия портов 3000 (Vite) и 8000 (backend) перед запуском браузера.
# Первый старт Vite (оптимизация зависимостей) и uvicorn --reload может занять заметно больше 15 секунд.
$waitSeconds = 60
$frontendReady = $false
$backendReady = $false
for ($i = 0; $i -lt $waitSeconds * 2; $i++)
{
    if (-not $frontendReady -and (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) { $frontendReady = $true }
    if (-not $backendReady -and (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) { $backendReady = $true }
    if ($frontendReady -and $backendReady) { break }
    # Задание бэкенда упало сразу (ошибка импорта и т.п.) — ждать порт дальше бессмысленно
    if (-not $backendReady -and (Get-Job -Name "RegenceBackend" -ErrorAction SilentlyContinue).State -in @("Failed", "Completed", "Stopped")) { break }
    Start-Sleep -Milliseconds 500
}
$workerJob = Get-Job -Name "RegenceWorker" -ErrorAction SilentlyContinue
$workerAlive = $workerJob -and $workerJob.State -eq "Running"

if ($frontendReady)
{
    Write-Host "[+] Открываем браузер на http://127.0.0.1:3000 ..." -ForegroundColor Magenta
    Start-Process "http://127.0.0.1:3000"
}
else
{
    Write-Host "[!] Порт 3000 не ответил за $waitSeconds секунд. Проверьте открывшееся окно терминала Vite." -ForegroundColor Red
    if (Test-Path $viteLog)
    {
        Write-Host "    Последние строки frontend/vite-dev.log:" -ForegroundColor Red
        Get-Content $viteLog -Tail 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }
    else
    {
        Write-Host "    Лог Vite пуст: окно не запустило npm (нет npm.cmd в PATH или окно закрылось сразу)." -ForegroundColor Red
    }
}
if (-not $backendReady)
{
    Write-Host "[!] Backend не открыл порт 8000. Логи: Receive-Job -Name RegenceBackend -Keep" -ForegroundColor Red
}
if (-not $workerAlive)
{
    Write-Host "[!] Celery-воркер остановился. Логи: Receive-Job -Name RegenceWorker -Keep" -ForegroundColor Red
}

$allOk = $frontendReady -and $backendReady -and $workerAlive
$statusColor = if ($allOk) { "Green" } else { "Yellow" }
Write-Host "========================================================" -ForegroundColor $statusColor
if ($allOk)
{
    Write-Host " Все сервисы запущены! Локальный сервер работает." -ForegroundColor Green
}
else
{
    Write-Host " Запуск завершён с проблемами — см. сообщения [!] выше." -ForegroundColor Yellow
}
Write-Host " Фронтенд: http://127.0.0.1:3000" -ForegroundColor Cyan
Write-Host " API Docs: http://127.0.0.1:8000/docs" -ForegroundColor Cyan
Write-Host " Просмотр логов бэкенда: Receive-Job -Name RegenceBackend -Keep" -ForegroundColor Gray
Write-Host " Логи Celery-воркера:   Receive-Job -Name RegenceWorker -Keep" -ForegroundColor Gray
Write-Host " Для остановки бэкенда: Get-Job | Stop-Job; Get-Job | Remove-Job" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Green