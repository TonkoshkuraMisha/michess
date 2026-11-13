// --- FILE: frontend/src/content/lessons/validate.ts ---
// Проверка урока (таск 14.1): возвращает список проблем — пустой, если урок корректен. Её вызывает тест в CI для
// каждого файла урока; ответы на шахматные вопросы дополнительно сверяет движком scripts/verify_lessons.py.

import {Chess} from 'chess.js';
import {LANGUAGES} from '../../i18n/core';
import type {ChoiceStep, CourseInfo, DemoAction, FindMoveStep, Lesson, LocalizedText, Step} from './format';
import {MAX_EXAM_QUESTIONS} from './format';

const SQUARE = /^[a-h][1-8]$/;
const PIECE = /^[wb][pnbrqkPNBRQK]$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

class Problems {
    readonly list: string[] = [];

    add(where: string, message: string) {
        this.list.push(`${where}: ${message}`);
    }

    text(where: string, value: LocalizedText | undefined, required = true) {
        if (!value) {
            if (required) this.add(where, 'missing text');
            return;
        }
        for (const language of LANGUAGES) {
            if (typeof value[language] !== 'string' || !value[language].trim()) this.add(where, `missing ${language} text`);
        }
    }
}

function load(fen: string, where: string, problems: Problems): Chess | null {
    try {
        return new Chess(fen);
    } catch (error) {
        problems.add(where, `invalid FEN "${fen}": ${(error as Error).message}`);
        return null;
    }
}

/** Ход uci, если он легален в позиции; иначе null. */
function play(game: Chess, uci: string): boolean {
    if (!UCI.test(uci)) return false;
    try {
        game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
        return true;
    } catch {
        return false;
    }
}

function legal(fen: string, uci: string): boolean {
    return play(new Chess(fen), uci);
}

function decor(step: Step, where: string, problems: Problems) {
    for (const arrow of step.arrows ?? []) {
        if (!SQUARE.test(arrow.from) || !SQUARE.test(arrow.to)) problems.add(where, `arrow with a bad square ${arrow.from}-${arrow.to}`);
    }
    for (const square of step.highlights ?? []) {
        if (!SQUARE.test(square)) problems.add(where, `highlight of a bad square ${square}`);
    }
    if (step.ghost && (!SQUARE.test(step.ghost.square) || !PIECE.test(step.ghost.piece))) {
        problems.add(where, `bad ghost piece ${step.ghost.piece} on ${step.ghost.square}`);
    }
}

function demo(actions: DemoAction[], game: Chess, where: string, problems: Problems) {
    if (actions.length === 0) problems.add(where, 'demo without actions');
    actions.forEach((action, i) => {
        const at = `${where}, action ${i + 1}`;
        switch (action.do) {
            case 'move':
                if (!play(game, action.uci)) problems.add(at, `illegal move ${action.uci} in ${game.fen()}`);
                break;
            case 'arrow':
                if (!SQUARE.test(action.from) || !SQUARE.test(action.to)) problems.add(at, 'arrow with a bad square');
                break;
            case 'highlight':
                if (!action.squares.length || action.squares.some((s) => !SQUARE.test(s))) problems.add(at, 'bad highlight squares');
                break;
            case 'ghost':
            case 'place':
                if (!SQUARE.test(action.square) || !PIECE.test(action.piece)) problems.add(at, 'bad piece or square');
                break;
            case 'pause':
                if (!(action.ms > 0 && action.ms <= 5000)) problems.add(at, 'pause must be 1..5000 ms');
                break;
            case 'clear':
                break;
            default:
                problems.add(at, `unknown action ${(action as {do: string}).do}`);
        }
    });
}

function findMove(step: FindMoveStep, where: string, problems: Problems) {
    problems.text(`${where}, hint`, step.hint, false);
    if (step.line.length === 0) {
        problems.add(where, 'question without moves');
        return;
    }
    const game = load(step.fen, where, problems);
    if (!game) return;
    step.line.forEach((task, i) => {
        const at = `${where}, move ${i + 1}`;
        if (task.answers.length === 0) problems.add(at, 'no correct answer');
        for (const answer of task.answers) {
            if (!legal(game.fen(), answer)) problems.add(at, `correct answer ${answer} is illegal in ${game.fen()}`);
        }
        for (const [uci, text] of Object.entries(task.wrong ?? {})) {
            if (!legal(game.fen(), uci)) problems.add(at, `wrong move ${uci} is illegal - its feedback would never show`);
            if (task.answers.includes(uci)) problems.add(at, `move ${uci} is both correct and wrong`);
            problems.text(`${at}, feedback for ${uci}`, text);
        }
        problems.text(`${at}, feedback for the correct move`, task.correct, false);
        const [main] = task.answers;
        if (!main || !play(game, main)) return;
        if (task.reply) {
            if (!play(game, task.reply)) problems.add(at, `computer reply ${task.reply} is illegal`);
        } else if (i < step.line.length - 1) {
            problems.add(at, 'no computer reply but the line goes on');
        }
        if (i < step.line.length - 1 && game.isGameOver()) problems.add(at, 'the game is over but the line goes on');
    });
}

function choice(step: ChoiceStep, where: string, problems: Problems) {
    if (step.fen) load(step.fen, where, problems);
    if (step.options.length < 2) problems.add(where, 'fewer than two options');
    if (!step.options.some((o) => o.correct)) problems.add(where, 'no correct option');
    step.options.forEach((option, i) => {
        problems.text(`${where}, option ${i + 1}`, option.text);
        problems.text(`${where}, feedback for option ${i + 1}`, option.feedback, false);
    });
}

function step(s: Step, where: string, problems: Problems) {
    problems.text(where, s.text);
    decor(s, where, problems);
    switch (s.type) {
        case 'text':
            load(s.fen, where, problems);
            break;
        case 'demo': {
            const game = load(s.fen, where, problems);
            if (game) demo(s.actions, game, where, problems);
            break;
        }
        case 'find_move':
            findMove(s, where, problems);
            break;
        case 'choice':
            choice(s, where, problems);
            break;
        default:
            problems.add(where, `unknown step type ${(s as {type: string}).type}`);
    }
}

export function validateLesson(lesson: Lesson, courses: CourseInfo[]): string[] {
    const problems = new Problems();
    const where = `lesson ${lesson.id}`;
    if (!SLUG.test(lesson.id)) problems.add(where, 'lesson id must be a slug: latin letters, digits, dashes');
    if (!courses.some((c) => c.id === lesson.course)) problems.add(where, `no course ${lesson.course}`);
    problems.text(`${where}, title`, lesson.title);
    problems.text(`${where}, summary`, lesson.summary);
    if (lesson.steps.length === 0) problems.add(where, 'lesson without steps');
    lesson.steps.forEach((s, i) => step(s, `${where}, step ${i + 1}`, problems));
    if (lesson.exam.length < 1 || lesson.exam.length > MAX_EXAM_QUESTIONS) {
        problems.add(where, `the exam needs 1..${MAX_EXAM_QUESTIONS} questions`);
    }
    lesson.exam.forEach((s, i) => {
        if (s.type !== 'find_move' && s.type !== 'choice') problems.add(`${where}, exam ${i + 1}`, 'the exam holds only questions');
        step(s, `${where}, exam ${i + 1}`, problems);
    });
    return problems.list;
}
