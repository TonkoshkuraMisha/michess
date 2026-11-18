// Перенос настроек при переименовании платформы michess → Regence: старые ключи переезжают, новые не затираются.

import {afterEach, describe, expect, it} from 'vitest';
import {migrateLegacyStorage, migrateStorage} from '../storageMigration';

afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

describe('перенос настроек michess_ → regence_', () => {
    it('старые ключи переезжают и удаляются; уже заданный новый не затирается; чужие не трогаются', () => {
        localStorage.setItem('michess_board_theme', 'walnut');
        localStorage.setItem('michess_language', 'uk');
        localStorage.setItem('regence_language', 'en');
        localStorage.setItem('other_key', 'x');
        expect(migrateStorage(localStorage)).toBe(1);
        expect(localStorage.getItem('regence_board_theme')).toBe('walnut');
        expect(localStorage.getItem('regence_language')).toBe('en');
        expect(localStorage.getItem('michess_board_theme')).toBeNull();
        expect(localStorage.getItem('michess_language')).toBeNull();
        expect(localStorage.getItem('other_key')).toBe('x');
        expect(migrateStorage(localStorage)).toBe(0);  // повторный запуск ничего не делает
    });

    it('оба хранилища при запуске', () => {
        sessionStorage.setItem('michess_xray_modes', '[]');
        migrateLegacyStorage();
        expect(sessionStorage.getItem('regence_xray_modes')).toBe('[]');
    });
});
