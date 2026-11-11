#!/bin/sh
# Резервное копирование PostgreSQL для docker-compose.prod.yml (сервис backup).
#
#   pg_backup.sh loop     — снимок сразу и затем каждые BACKUP_INTERVAL_HOURS часов (по умолчанию)
#   pg_backup.sh once     — один снимок
#   pg_backup.sh verify   — восстановить последний снимок во временную базу и проверить его
#   pg_backup.sh restore FILE — восстановить снимок в рабочую базу (останавливайте api и worker!)
#
# Снимки — pg_dump в custom-формате (сжатый, восстанавливается pg_restore выборочно и параллельно),
# имя michess_YYYYmmdd_HHMMSS.dump. Файл пишется во временный и переименовывается только после
# успешного pg_dump: оборванный снимок никогда не выглядит готовым. Снимки старше
# BACKUP_KEEP_DAYS дней удаляются.
#
# Переменные: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, PGHOST (db), BACKUP_DIR (/backups),
# BACKUP_INTERVAL_HOURS (24), BACKUP_KEEP_DAYS (14).
set -eu

: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"
export PGHOST="${PGHOST:-db}" PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
CHECK_DB="${POSTGRES_DB}_restore_check"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: $*"; }

wait_for_db() {
    until pg_isready -q -d "$POSTGRES_DB"; do sleep 2; done
}

latest_backup() {
    ls -1 "$BACKUP_DIR"/michess_*.dump 2>/dev/null | sort | tail -n 1
}

backup_once() {
    mkdir -p "$BACKUP_DIR"
    target="$BACKUP_DIR/michess_$(date -u '+%Y%m%d_%H%M%S').dump"
    tmp="$target.partial"
    if pg_dump -Fc -d "$POSTGRES_DB" -f "$tmp"; then
        mv "$tmp" "$target"
        log "snapshot $(basename "$target") ($(du -h "$target" | cut -f1))"
    else
        rm -f "$tmp"
        log "ERROR: pg_dump failed"
        return 1
    fi
    find "$BACKUP_DIR" -name 'michess_*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete \
        | sed 's/^/removed old snapshot /'
    find "$BACKUP_DIR" -name '*.partial' -type f -mmin +60 -delete
}

# Снимок, который не восстанавливается, хуже отсутствия снимка: о проблеме узнают в день аварии.
verify_latest() {
    file="$(latest_backup)"
    [ -n "$file" ] || { log "ERROR: no snapshots in $BACKUP_DIR"; return 1; }
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
    [ "$status" -eq 0 ] || log "ERROR: snapshot $(basename "$file") failed to restore"
    return "$status"
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
            sleep "$((INTERVAL_HOURS * 3600))"
        done
        ;;
    *)
        echo "usage: $0 [loop|once|verify|restore FILE]" >&2
        exit 2
        ;;
esac
