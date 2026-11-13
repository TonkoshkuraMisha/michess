# --- FILE: scripts/sync_host.ps1 ---
#
# Синхронизация рабочего места между хостами (игровой ноут, стационарный ПК, рабочий ноут).
#
#   .\scripts\sync_host.ps1           — «пришёл»: подтянуть код, зависимости, движок, БД, данные
#   .\scripts\sync_host.ps1 -Resume   — то же + переключиться на последнюю WIP-ветку с другого хоста
#   .\scripts\sync_host.ps1 -Leave    — «ухожу»: закоммитить и запушить всё незаконченное
#   .\scripts\sync_host.ps1 -GitOnly  — только git (быстро, без venv/npm/Docker)
#
# В git не попадают секреты (.env), venv, node_modules, Stockfish и PGN-архивы — скрипт
# восстанавливает их на любом хосте; незаконченная работа уезжает в ветку wip/<хост>-<время>.

[CmdletBinding()]
param(
    [switch]$Leave,
    [switch]$Resume,
    [switch]$GitOnly,
    [string]$Message = ""
)

$ErrorActionPreference = "Continue"
# Кириллица в выводе git и самого скрипта в Windows PowerShell 5.1.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
# Python-скрипты печатают по-русски: без этого вывод в не-консоль падает на cp1252.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pythonExe = Join-Path $root "michess_env\Scripts\python.exe"
$frontendDir = Join-Path $root "frontend"
$hostTag = ($env:COMPUTERNAME).ToLower() -replace '[^a-z0-9-]', '-'
$protectedBranches = @("dev", "master")
$problems = New-Object System.Collections.Generic.List[string]

function Step([string]$text) { Write-Host "`n[*] $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "    [+] $text" -ForegroundColor Green }
function Info([string]$text) { Write-Host "    $text" -ForegroundColor Gray }
function Warn([string]$text) {
    Write-Host "    [!] $text" -ForegroundColor Yellow
    $script:problems.Add($text)
}

# Простая функция (не advanced): -c, --quiet и прочие флаги уходят в git как есть через $args.
function Invoke-Git {
    $out = & git @args
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') завершился с кодом $LASTEXITCODE" }
    return $out
}

function CurrentBranch { return (& git rev-parse --abbrev-ref HEAD).Trim() }

function HasUpstream {
    & git rev-parse --abbrev-ref --symbolic-full-name "@{u}" *> $null
    return $LASTEXITCODE -eq 0
}

function DirtyFiles { return @(& git status --porcelain) | Where-Object { $_ } }

function FileHash([string[]]$paths) {
    $existing = $paths | Where-Object { Test-Path $_ }
    if (-not $existing) { return "" }
    return (($existing | ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash }) -join "")
}

# Ключи из KEY=VALUE, без комментариев и пустых строк.
function EnvKeys([string]$path) {
    if (-not (Test-Path $path)) { return @() }
    return Get-Content $path | Where-Object { $_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=' } |
        ForEach-Object { $Matches[1] }
}

# Локальные ветки, у которых есть незапушенные коммиты или нет upstream.
function UnpushedBranches {
    $result = @()
    foreach ($line in (& git for-each-ref refs/heads --format="%(refname:short)|%(upstream:short)|%(upstream:track)")) {
        $name, $upstream, $track = $line -split '\|', 3
        if (-not $upstream) { $result += "$name (нет на GitHub)" }
        elseif ($track -match 'ahead') { $result += "$name $track" }
    }
    return $result
}

# ---------------------------------------------------------------------------------------------
# Режим «ухожу»
# ---------------------------------------------------------------------------------------------
function Invoke-Leave {
    Write-Host "=== Michess: уход с хоста $hostTag ===" -ForegroundColor Cyan

    Step "Получаем состояние GitHub"
    Invoke-Git fetch --prune --quiet

    $branch = CurrentBranch
    $dirty = DirtyFiles
    if ($dirty) {
        Step "Незакоммиченные изменения ($(@($dirty).Count) файл(ов))"
        $dirty | ForEach-Object { Info $_ }

        if ($protectedBranches -contains $branch) {
            # dev/master не засоряем WIP-коммитами: работа уезжает в отдельную ветку.
            $wipBranch = "wip/$hostTag-$(Get-Date -Format 'yyyyMMdd-HHmm')"
            Invoke-Git switch --quiet -c $wipBranch
            Ok "Создана ветка $wipBranch (от $branch)"
            $branch = $wipBranch
        }
        $text = if ($Message) { $Message } else { "незаконченная работа" }
        Invoke-Git add -A
        Invoke-Git commit --quiet -m "wip($hostTag): $text"
        Ok "Закоммичено в $branch"
    }
    else {
        Ok "Незакоммиченных изменений нет"
    }

    Step "Отправляем ветку $branch на GitHub"
    if (HasUpstream) {
        Invoke-Git push --quiet
    }
    else {
        Invoke-Git push --quiet -u origin $branch
    }
    Ok "$branch запушена"

    $leftovers = UnpushedBranches
    if ($leftovers) {
        Warn "Незапушенная работа в других ветках (запушьте, если нужна на других хостах): $($leftovers -join '; ')"
    }
    $stashes = @(& git stash list)
    if ($stashes) {
        Warn "Есть stash ($($stashes.Count)) — он живёт только на этом хосте: git stash list"
    }

    Summary "Можно уходить. На другом хосте: .\scripts\sync_host.ps1 -Resume"
}

# ---------------------------------------------------------------------------------------------
# Режим «пришёл»
# ---------------------------------------------------------------------------------------------
function Sync-Git {
    Step "Git: настройки репозитория"
    # Локально для репозитория, чтобы не трогать чужие глобальные настройки.
    Invoke-Git config pull.rebase true
    Invoke-Git config fetch.prune true
    Invoke-Git config rebase.autoStash true
    Ok "pull.rebase=true, fetch.prune=true, rebase.autoStash=true"
    Info "Автор коммитов на этом хосте: $(& git config user.name) <$(& git config user.email)>"

    Step "Git: получаем изменения с GitHub"
    Invoke-Git fetch --prune --quiet

    if ($Resume) {
        $wip = @(& git for-each-ref refs/remotes/origin/wip --sort=-committerdate --format="%(refname:lstrip=3)")
        if (-not $wip) {
            Warn "WIP-веток на GitHub нет — остаюсь на $(CurrentBranch)"
        }
        elseif (DirtyFiles) {
            Warn "Есть незакоммиченные изменения — не переключаюсь на $($wip[0]). Сначала закоммитьте их."
        }
        else {
            $target = $wip[0]
            if (& git rev-parse --verify --quiet "refs/heads/$target") {
                Invoke-Git switch --quiet $target
            }
            else {
                Invoke-Git switch --quiet --track "origin/$target"
            }
            Ok "Переключился на $target"
        }
    }

    $branch = CurrentBranch
    if (HasUpstream) {
        $before = (& git rev-parse HEAD).Trim()
        & git pull --quiet
        if ($LASTEXITCODE -ne 0) {
            Warn "git pull не удался (конфликт?). Разрешите вручную: git status"
            return
        }
        $after = (& git rev-parse HEAD).Trim()
        if ($before -eq $after) { Ok "$branch уже актуальна" }
        else { Ok "$branch обновлена: $(@(& git rev-list "$before..$after").Count) новых коммит(ов)" }

        $ahead = [int](& git rev-list --count "@{u}..HEAD")
        if ($ahead -gt 0) { Warn "В $branch $ahead незапушенных коммит(ов) — выполните git push" }
    }
    else {
        Warn "У ветки $branch нет upstream на GitHub — она есть только на этом хосте"
    }

    # dev обновляем, даже если работаем в другой ветке: от неё создаются новые ветки.
    foreach ($b in $protectedBranches) {
        if ($b -eq $branch) { continue }
        $behind = & git rev-list --count "$b..origin/$b" 2>$null
        $aheadB = & git rev-list --count "origin/$b..$b" 2>$null
        if ($LASTEXITCODE -ne 0) { continue }
        if ([int]$behind -gt 0 -and [int]$aheadB -eq 0) {
            Invoke-Git fetch --quiet origin "${b}:${b}"
            Ok "Локальная $b подтянута (+$behind)"
        }
        elseif ([int]$aheadB -gt 0) {
            Warn "В локальной $b $aheadB незапушенных коммит(ов)"
        }
    }

    $wipOthers = @(& git for-each-ref refs/remotes/origin/wip --sort=-committerdate --format="%(refname:lstrip=3)  %(committerdate:relative)")
    if ($wipOthers -and -not $Resume) {
        Info "Незаконченная работа с других хостов (продолжить: -Resume):"
        $wipOthers | ForEach-Object { Info "  $_" }
    }
}

function Sync-Env {
    Step "Секреты и настройки (.env)"
    foreach ($pair in @(@($root, "корневой"), @($frontendDir, "frontend"))) {
        $dir, $label = $pair
        $envFile = Join-Path $dir ".env"
        $example = Join-Path $dir ".env.example"
        if (-not (Test-Path $example)) { continue }
        if (-not (Test-Path $envFile)) {
            Copy-Item $example $envFile
            Warn "$label .env создан из шаблона — впишите секреты из менеджера паролей"
            continue
        }
        $missing = @(EnvKeys $example | Where-Object { (EnvKeys $envFile) -notcontains $_ })
        if ($missing) { Info "$label .env: нет необязательных ключей $($missing -join ', ') — берутся значения по умолчанию" }
        else { Ok "$label .env содержит все ключи шаблона" }
    }
    # Обязательные поля (пароль БД, SECRET_KEY) проверяет сам Settings: значений по умолчанию у них нет.
    if (Test-Path $pythonExe) {
        $err = & $pythonExe -c "from src.core.config import settings" 2>&1
        if ($LASTEXITCODE -eq 0) { Ok "Настройки backend загружаются" }
        else { Warn "Настройки backend не загружаются — не хватает обязательных значений в .env: $(($err | Select-Object -Last 3) -join ' ')" }
    }
}

function Sync-Python {
    Step "Python-окружение (michess_env)"
    if (-not (Test-Path $pythonExe)) {
        Info "Создаём виртуальное окружение..."
        & python -m venv (Join-Path $root "michess_env")
        if ($LASTEXITCODE -ne 0) { Warn "Не удалось создать venv — установлен ли Python 3?"; return }
        & $pythonExe -m pip install --quiet --upgrade pip
    }
    $reqFiles = @("requirements.txt", "requirements-dev.txt") | ForEach-Object { Join-Path $root $_ }
    $stamp = Join-Path $root "michess_env\.sync_requirements"
    $hash = FileHash $reqFiles
    if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $hash) {
        Ok "Зависимости не менялись"
        return
    }
    $pipArgs = @("-m", "pip", "install", "--quiet", "--disable-pip-version-check")
    foreach ($f in $reqFiles) { if (Test-Path $f) { $pipArgs += @("-r", $f) } }
    & $pythonExe @pipArgs
    if ($LASTEXITCODE -eq 0) { Set-Content $stamp $hash; Ok "Зависимости установлены" }
    else { Warn "pip install завершился с ошибкой" }
}

function Sync-Frontend {
    Step "Фронтенд (node_modules)"
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Warn "npm не найден — установите Node.js"; return }
    $lock = Join-Path $frontendDir "package-lock.json"
    $stamp = Join-Path $frontendDir "node_modules\.sync_lock"
    $hash = FileHash @($lock)
    if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $hash) {
        Ok "Зависимости не менялись"
        return
    }
    if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
        Warn "Vite запущен на :3000 — npm ci пропущен (остановите dev-сервер и запустите скрипт снова)"
        return
    }
    Push-Location $frontendDir
    & npm ci --no-audit --no-fund --loglevel=error
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -eq 0) { Set-Content $stamp $hash; Ok "npm ci выполнен по package-lock.json" }
    else { Warn "npm ci завершился с ошибкой" }
}

function Sync-Stockfish {
    Step "Движок Stockfish (официальный релиз с GitHub)"
    # setup_stockfish.py сам пропускает скачивание, если бинарник уже на месте.
    & $pythonExe (Join-Path $root "scripts\setup_stockfish.py")
    if ($LASTEXITCODE -ne 0) { Warn "Stockfish не установлен — боты будут играть без движка" }
}

function Sync-Database {
    Step "PostgreSQL и Redis (Docker)"
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Warn "Docker не найден"; return }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        $desktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
        if (Test-Path $desktop) {
            Info "Docker Desktop не запущен — запускаем и ждём движок (до 2 минут)..."
            Start-Process $desktop
            for ($i = 0; $i -lt 60; $i++) {
                Start-Sleep -Seconds 2
                & docker info *> $null
                if ($LASTEXITCODE -eq 0) { break }
            }
        }
    }
    & docker compose up -d --wait db redis
    if ($LASTEXITCODE -ne 0) { Warn "Docker Desktop не запущен — миграции и данные пропущены"; return }
    Ok "Контейнеры db и redis работают"

    Step "Миграции БД (Alembic)"
    & $pythonExe -m alembic upgrade head
    if ($LASTEXITCODE -eq 0) { Ok "Схема БД актуальна: $(& $pythonExe -m alembic current 2>$null)" }
    else { Warn "alembic upgrade head завершился с ошибкой" }

    Step "База задач"
    & $pythonExe -m scripts.import_puzzles
    if ($LASTEXITCODE -eq 0) { Ok "Задачи загружены" } else { Warn "Загрузка задач завершилась с ошибкой" }

    Step "Архив партий чемпионов мира"
    if (Test-Path (Join-Path $root "src\db\data\pgns\Steinitz.pgn")) {
        Ok "PGN-архивы на месте"
    }
    else {
        & $pythonExe -m src.db.seed
        if ($LASTEXITCODE -eq 0) { Ok "PGN-архивы скачаны и импортированы" }
        else { Warn "Импорт партий чемпионов не удался" }
    }
}

function Summary([string]$okText) {
    Write-Host ""
    if ($problems.Count -eq 0) {
        Write-Host "=== $okText ===" -ForegroundColor Green
    }
    else {
        Write-Host "=== Готово, но требует внимания: ===" -ForegroundColor Yellow
        $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    }
}

try {
    if ($Leave) {
        Invoke-Leave
    }
    else {
        Write-Host "=== Michess: синхронизация хоста $hostTag ===" -ForegroundColor Cyan
        Sync-Git
        if ($GitOnly) { Summary "Git синхронизирован"; exit $(if ($problems.Count) { 2 } else { 0 }) }
        Sync-Env
        Sync-Python
        Sync-Frontend
        Sync-Stockfish
        Sync-Database
        Summary "Хост синхронизирован. Запуск: .\start_dev.ps1"
    }
}
catch {
    Write-Host "`n[x] $_" -ForegroundColor Red
    exit 1
}
if ($problems.Count -gt 0) { exit 2 }
