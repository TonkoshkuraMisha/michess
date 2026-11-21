#!/bin/sh
# Резервное копирование PostgreSQL для docker-compose.prod.yml (сервис backup).
#
#   pg_backup.sh loop     — снимок сразу и затем каждые BACKUP_INTERVAL_HOURS часов (по умолчанию)
#   pg_backup.sh once     — один снимок
#   pg_backup.sh verify   — восстановить последний снимок во временную базу и проверить его
#   pg_backup.sh restore FILE — восстановить снимок в рабочую базу (останавливайте api и worker!)
#
# Снимки — pg_dump в custom-формате (сжатый, восстанавливается pg_restore выборочно и параллельно),
# имя regence_YYYYmmdd_HHMMSS.dump. Файл пишется во временный и переименовывается только после
# успешного pg_dump: оборванный снимок никогда не выглядит готовым. Снимки старше
# BACKUP_KEEP_DAYS дней удаляются.
#
# В режиме loop раз в BACKUP_VERIFY_EVERY_DAYS суток (7; 0 — выключено) после снимка сама запускается проверка
# восстановления. Сбой снимка или проверки пишется в журнал строкой «ERROR» и, если задан BACKUP_ALERT_WEBHOOK_URL,
# уходит POST-запросом с текстом (Slack/Telegram-мост/любой приёмник). Время последней проверки — файл
# .last_verify в BACKUP_DIR. Копия снимков вне сервера — отдельный сервис backup-offsite (DEPLOY, раздел 5).
#
# Переменные: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, PGHOST (db), BACKUP_DIR (/backups),
# BACKUP_INTERVAL_HOURS (24), BACKUP_KEEP_DAYS (14), BACKUP_VERIFY_EVERY_DAYS (7), BACKUP_ALERT_WEBHOOK_URL.
set -eu

: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"
export PGHOST="${PGHOST:-db}" PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
VERIFY_EVERY_DAYS="${BACKUP_VERIFY_EVERY_DAYS:-7}"
ALERT_URL="${BACKUP_ALERT_WEBHOOK_URL:-}"
VERIFY_STAMP="$BACKUP_DIR/.last_verify"
CHECK_DB="${POSTGRES_DB}_restore_check"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: $*"; }

# Оповещение о сбое: строка в журнал всегда, POST на вебхук — если он задан. Сбой самого оповещения
# не должен ронять расписание, поэтому его ошибка только пишется в журнал.
alert() {
    log "ERROR: $*"
    [ -n "$ALERT_URL" ] || return 0
    wget -q -T 10 -O /dev/null --post-data "regence backup: $*" "$ALERT_URL"         || log "WARNING: alert webhook is unreachable"
}

wait_for_db() {
    until pg_isready -q -d "$POSTGRES_DB"; do sleep 2; done
}

latest_backup() {
    ls -1 "$BACKUP_DIR"/regence_*.dump 2>/dev/null | sort | tail -n 1
}

backup_once() {
    mkdir -p "$BACKUP_DIR"
    target="$BACKUP_DIR/regence_$(date -u '+%Y%m%d_%H%M%S').dump"
    tmp="$target.partial"
    if pg_dump -Fc -d "$POSTGRES_DB" -f "$tmp"; then
        mv "$tmp" "$target"
        log "snapshot $(basename "$target") ($(du -h "$target" | cut -f1))"
    else
        rm -f "$tmp"
        alert "pg_dump failed"
        return 1
    fi
    find "$BACKUP_DIR" -name 'regence_*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete \
        | sed 's/^/removed old snapshot /'
    find "$BACKUP_DIR" -name '*.partial' -type f -mmin +60 -delete
}

# Снимок, который не восстанавливается, хуже отсутствия снимка: о проблеме узнают в день аварии.
verify_latest() {
    file="$(latest_backup)"
    [ -n "$file" ] || { alert "no snapshots in $BACKUP_DIR"; return 1; }
    psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$CHECK_DB\"" -c "CREATE DATABASE \"$CHECK_DB\""
    status=0
    if pg_restore --no-owner -d "$CHECK_DB" "$file"; then
        summary="$(psql -At -d "$CHECK_DB" -c \
            "SELECT (SELECT version_num FROM alembic_version) || ' users=' || (SELECT count(*) FROM users)
                    || ' games=' || (SELECT count(*) FROM games)")" || status=1
        [ "$status" -eq 0 ] && log "verified $(basename "$file"): revision $summary"
    else
        status=1
    fi
    psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$CHECK_DB\""
    [ "$status" -eq 0 ] || alert "snapshot $(basename "$file") failed to restore"
    return "$status"
}

# Плановая проверка: не чаще раза в VERIFY_EVERY_DAYS суток. Отметка времени ставится и при провале,
# чтобы сломанный снимок не поднимал тревогу после каждого снимка, а раз в период.
verify_if_due() {
    [ "$VERIFY_EVERY_DAYS" -gt 0 ] || return 0
    if [ -f "$VERIFY_STAMP" ] && [ -z "$(find "$VERIFY_STAMP" -mtime +"$((VERIFY_EVERY_DAYS - 1))" 2>/dev/null)" ]; then
        return 0
    fi
    verify_latest || true
    touch "$VERIFY_STAMP"
}

restore() {
    file="$1"
    [ -f "$file" ] || file="$BACKUP_DIR/$1"
    [ -f "$file" ] || { log "ERROR: snapshot $1 not found"; return 1; }
    log "restoring $(basename "$file") into $POSTGRES_DB"
    pg_restore --clean --if-exists --no-owner --single-transaction -d "$POSTGRES_DB" "$file"
    log "restore finished"
}

case "${1:-loop}" in
    once)
        wait_for_db
        backup_once
        ;;
    verify)
        wait_for_db
        verify_latest
        ;;
    restore)
        [ $# -ge 2 ] || { echo "usage: $0 restore FILE" >&2; exit 2; }
        wait_for_db
        restore "$2"
        ;;
    loop)
        wait_for_db
        log "every ${INTERVAL_HOURS}h into $BACKUP_DIR, keeping ${KEEP_DAYS} days"
        while true; do
            # Сбой одного снимка не останавливает расписание: следующая попытка — через интервал.
            backup_once || true
            verify_if_due
            sleep "$((INTERVAL_HOURS * 3600))"
        done
        ;;
    *)
        echo "usage: $0 [loop|once|verify|restore FILE]" >&2
        exit 2
        ;;
esac
