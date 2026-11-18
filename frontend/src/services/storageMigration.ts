// --- FILE: frontend/src/services/storageMigration.ts ---
// Переименование платформы michess → Regence (решение владельца 18.11.2026): настройки игрока в браузере (тема и
// размер доски, набор фигур, язык, звук, наставник, рентген, ники импорта и т. п.) хранились под ключами «michess_…».
// Однократно при запуске каждый такой ключ переносится в «regence_…» (если нового ещё нет) и удаляется — игрок не
// теряет настроек. Ошибки хранилища (приватный режим, запрет) не мешают запуску. Вызов — src/main.tsx.

/** Старый и новый префиксы ключей хранилища. */
export const LEGACY_PREFIX = 'michess_';
export const CURRENT_PREFIX = 'regence_';

/** Переносит ключи LEGACY_PREFIX в CURRENT_PREFIX в одном хранилище; возвращает число перенесённых. */
export function migrateStorage(storage: Storage): number {
    const legacy: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key);
    }
    let moved = 0;
    for (const key of legacy) {
        const next = CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length);
        const value = storage.getItem(key);
        if (value !== null && storage.getItem(next) === null) {
            storage.setItem(next, value);
            moved += 1;
        }
        storage.removeItem(key);
    }
    return moved;
}

/** localStorage и sessionStorage; недоступное хранилище пропускается. */
export function migrateLegacyStorage(): void {
    for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
        try {
            migrateStorage(pick());
        } catch {
            // хранилище недоступно — нечего переносить
        }
    }
}
