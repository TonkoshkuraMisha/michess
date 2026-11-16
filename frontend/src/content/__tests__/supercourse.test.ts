// Большой курс (таск 27.6): коды модулей уникальны и соответствуют уровню, ветви известны, каждый шаг ведёт в
// существующий раздел; у каждого уровня есть наполненные модули и экзамен.

import {describe, expect, it} from 'vitest';
import {BRANCHES, COURSE, courseProgressId, LEVEL_COUNT, moduleTitleKey} from '../supercourse';
import type {Activity} from '../programs';
import {lessonById} from '../lessons';
import {BASICS} from '../basics/levels';
import {EXERCISES} from '../../components/learn/EndgameTrainer';
import {TRAINER_IDS} from '../../services/trainers';
import {MINI_GAMES} from '../../components/trainers/MiniGames';
import {STRUCTURES} from '../../services/library';
import {hasMessage} from '../../i18n';

const EXAM = ['F', 'A', 'B', 'C', 'D', 'E', 'G', 'H', 'I', 'J', 'endgame'];

function exists(activity: Activity): boolean {
    switch (activity.kind) {
        case 'basics': return BASICS.some((s) => s.id === activity.id);
        case 'lesson': return lessonById(activity.id) !== undefined;
        case 'mates':
        case 'theme': return hasMessage(`themes.${activity.id}.name`);
        case 'endgame': return EXERCISES.some((e) => e.id === activity.id);
        case 'trainer': return (TRAINER_IDS as readonly string[]).includes(activity.id);
        case 'mini': return (MINI_GAMES as readonly string[]).includes(activity.id);
        case 'exam': return EXAM.includes(activity.id);
        case 'library': return !activity.structure || (STRUCTURES as readonly string[]).includes(activity.structure);
        default: return true;
    }
}

describe('Большой курс', () => {
    it('коды, уровни и ветви', () => {
        const codes = COURSE.map((m) => m.code);
        expect(new Set(codes).size).toBe(codes.length);
        for (const module of COURSE) {
            expect(module.level).toBeGreaterThanOrEqual(0);
            expect(module.level).toBeLessThan(LEVEL_COUNT);
            expect(BRANCHES).toContain(module.branch);
            expect(hasMessage(moduleTitleKey(module.code))).toBe(true);
            expect(courseProgressId(module.code)).toMatch(/^[a-z0-9][a-z0-9-]{1,63}$/);
        }
    });

    it('каждый шаг существует; на каждом уровне есть наполненные модули и экзамен', () => {
        const missing = COURSE.flatMap((m) => m.steps.filter((s) => !exists(s)).map((s) => `${m.code}: ${JSON.stringify(s)}`));
        expect(missing).toEqual([]);
        for (let level = 0; level < LEVEL_COUNT; level++) {
            const modules = COURSE.filter((m) => m.level === level);
            expect(modules.filter((m) => m.steps.length > 0).length).toBeGreaterThan(5);
            expect(modules.some((m) => m.code === `X${level}`)).toBe(true);
        }
    });
});

describe('Обязательные позиции (27.9)', () => {
    it('три ступени из существующих упражнений, без повторов', async () => {
        const {MUST_KNOW} = await import('../mustKnow');
        const all = MUST_KNOW.flat();
        expect(MUST_KNOW).toHaveLength(3);
        expect(new Set(all).size).toBe(all.length);
        expect(all.filter((id) => !EXERCISES.some((e) => e.id === id))).toEqual([]);
        expect(all.every((id) => hasMessage(`endgames.items.${id}`))).toBe(true);
    });
});
