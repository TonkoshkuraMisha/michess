// Первый вход (таск 17.8): соперник первой партии по стартовому рейтингу.

import {describe, expect, it} from 'vitest';
import {pickFirstOpponent} from '../onboarding';
import type {CatalogArchetype} from '../botCatalog';
import {DEFAULT_CONFIG} from '../personalities';

const archetype = (id: string, rating: number) => ({
    id, rating, declared_rating: rating, measured: true, games: 80, ci95: 100, config: DEFAULT_CONFIG,
}) as unknown as CatalogArchetype;

const CATALOG = [archetype('quiet', 848), archetype('rusher', 792), archetype('cavalier', 1198), archetype('centralist', 1395)];

describe('соперник первой партии', () => {
    it('самый сильный архетип не сильнее игрока — по измеренной силе', () => {
        expect(pickFirstOpponent(CATALOG, 1200)?.id).toBe('cavalier');
        expect(pickFirstOpponent(CATALOG, 1850)?.id).toBe('centralist');
    });

    it('новичку, который слабее всех, — самый слабый', () => {
        expect(pickFirstOpponent(CATALOG, 600)?.id).toBe('rusher');
    });

    it('пустой каталог — соперника нет', () => {
        expect(pickFirstOpponent([], 1200)).toBeNull();
    });
});
