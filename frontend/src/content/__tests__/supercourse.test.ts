// Большой курс (таск 27.6): коды модулей уникальны и соответствуют уровню, ветви известны, каждый шаг ведёт в
// существующий раздел; у каждого уровня есть наполненные модули и экзамен.

import {describe, expect, it} from 'vitest';
import {BRANCHES, COURSE, courseProgressId, coverage, LEVEL_COUNT, moduleStatus, moduleTitleKey} from '../supercourse';
import type {CourseModule} from '../supercourse';
import type {Activity} from '../programs';
import {lessonById} from '../lessons';
import {BASICS} from '../basics/levels';
import {EXERCISES} from '../../components/learn/EndgameTrainer';
import {TRAINER_IDS} from '../../services/trainers';
import {MINI_GAMES} from '../../components/trainers/MiniGames';
import {STRUCTURES} from '../../services/library';
import {hasMessage} from '../../i18n';

const EXAM = ['F', 'A', 'B', 'C', 'D', 'E', 'G', 'H', 'I', 'J', 'endgame',
    'level0', 'level1', 'level2', 'level3', 'level4', 'level5'];  // экзамены уровней — 27.12

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

describe('экзамены уровней (27.12)', () => {
    it('уровень пройден, когда оценка своего экзамена уровня не ниже порога', async () => {
        const {examSections, levelExamPassed} = await import('../supercourse');
        expect(examSections(1)).toEqual(['level1']);
        expect(levelExamPassed(1, {level1: {estimate: 1000}})).toBe(true);
        expect(levelExamPassed(1, {level1: {estimate: 999}})).toBe(false);
        expect(levelExamPassed(2, {A: {estimate: 2000}, B: {estimate: 2000}})).toBe(false);  // диагностика не в счёт
        for (let level = 0; level < LEVEL_COUNT; level++) expect(examSections(level)).toEqual([`level${level}`]);
    });
});

describe('статусы ячеек и покрытие для автора', () => {
    const at = (code: string, steps: number, draft = 0): CourseModule => ({
        code, level: Number(code.slice(1).split('.')[0]), branch: code[0] as CourseModule['branch'],
        steps: Array.from({length: steps}, () => ({kind: 'guess'}) as const),
        ...(draft ? {draft: Array.from({length: draft}, () => ({kind: 'guess'}) as const)} : {}),
    });

    it('готовые шаги важнее черновиков; без тех и других — пусто', () => {
        expect(moduleStatus(at('T1.1', 2, 1))).toBe('ready');
        expect(moduleStatus(at('T1.2', 0, 1))).toBe('draft');
        expect(moduleStatus(at('T1.3', 0))).toBe('empty');
    });

    it('покрытие считает модули по уровню и ветви', () => {
        const table = coverage([at('T1.1', 1), at('T1.2', 0, 2), at('E1.1', 0), at('M3.1', 3)]);
        expect(table).toHaveLength(LEVEL_COUNT);
        expect(table[1][BRANCHES.indexOf('T')]).toEqual({ready: 1, draft: 1, empty: 0});
        expect(table[1][BRANCHES.indexOf('E')]).toEqual({ready: 0, draft: 0, empty: 1});
        expect(table[3][BRANCHES.indexOf('M')]).toEqual({ready: 1, draft: 0, empty: 0});
        expect(table[0].every((cell) => cell.ready + cell.draft + cell.empty === 0)).toBe(true);
    });

    it('в настоящем курсе все модули готовы, черновиков нет', () => {
        const total = coverage().flat().reduce((sum, cell) => sum + cell.ready, 0);
        expect(total).toBe(COURSE.length);
        expect(COURSE.every((m) => moduleStatus(m) === 'ready')).toBe(true);
    });
});

