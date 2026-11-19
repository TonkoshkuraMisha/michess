// --- FILE: frontend/src/components/study/StudyPages.tsx ---
// Совместный разбор и занятие с тренером (таск 17.3). /study — создать комнату, войти по коду, свои материалы;
// /study/:code — комната: ведущий ведёт доску (ходы, стрелки четырёх цветов, светлая и тёмная подсветка, «призрак»,
// позиция по FEN), задаёт вопрос (ход на своей доске или выбор варианта, с таймером) и копит шаги занятия в урок формата
// школы (14.1): скачать JSON или сохранить как материал клуба. Ученики видят доску (опрос раз в POLL_MS), отвечают, чат.
// Данные — services/study.ts (/api/v1/study, только с входом; комната живёт в Redis, src/services/study_room.py).
// Маршруты /study и /study/:code (App.tsx). Уроки проверяет content/lessons/validate.ts до скачивания и сохранения.
// StudyLobby — вход (создать комнату, ввести код, свои материалы); StudyRoomPage — комната ведущего и ученика;
// lessonProblems — ошибки формата урока (пусто — урок можно скачать или сохранить).

import {useCallback, useEffect, useRef, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {Download, Eraser, Presentation, Send} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {downloadText} from '../../services/pgnExport';
import {studyApi} from '../../services/study';
import type {ArrowColor, StudyBoard, StudyRoom} from '../../services/study';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {validateLesson} from '../../content/lessons/validate';
import type {CourseInfo, Lesson} from '../../content/lessons/format';

/** Период опроса состояния комнаты, мс: рассылки по WebSocket у комнаты нет. */
export const POLL_MS = 1000;
/** Цвета стрелок ведущего; порядок — порядок кнопок выбора цвета. */
const COLORS: ArrowColor[] = ['green', 'red', 'blue', 'yellow'];
/** Инструмент ведущего: ход фигурой, стрелка или светлая/тёмная подсветка поля. */
type Tool = 'move' | 'arrow' | 'light' | 'dark';
/** Служебный курс «club», под которым проверяется урок занятия (в каталоге курсов его нет). */
const CLUB_COURSE: CourseInfo = {id: 'club', order: 1, title: {en: 'Club', uk: 'Club', ru: 'Club'}, summary: {en: '', uk: '', ru: ''}};
/** Сколько последних вопросов занятия идёт в экзамен урока. */
const MAX_EXAM = 5;

/** Урок из шагов занятия (формат 14.1): все шаги — по порядку, вопросы занятия (до MAX_EXAM последних) — экзамен. */
export function sessionLesson(code: string, title: string, steps: Record<string, unknown>[]): Lesson {
    const name = title || code;
    const questions = steps.filter((s) => s.type === 'choice' || s.type === 'find_move');
    return {
        id: `club-${code}`.toLowerCase(), course: 'club', order: 1, title: {en: name, uk: name, ru: name},
        summary: {en: name, uk: name, ru: name}, steps, exam: questions.slice(-MAX_EXAM),
    } as unknown as Lesson;
}

export function lessonProblems(lesson: Lesson): string[] {
    return validateLesson(lesson, [CLUB_COURSE]);
}

/** Шаг урока из доски (формат 14.1): текст ведущего на всех трёх языках одинаковый — это его собственный текст. */
export function lessonStep(board: StudyBoard, note: string) {
    const text = {en: note, uk: note, ru: note};
    return {
        type: 'text', fen: board.fen, text,
        ...(board.arrows.length ? {arrows: board.arrows.map((a) => ({from: a.from, to: a.to, color: a.color}))} : {}),
        ...(board.highlights.length ? {highlights: board.highlights.map((h) => h.square)} : {}),
    };
}

export function StudyLobby() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [code, setCode] = useState('');
    const [materials, setMaterials] = useState<{ id: number; title: string }[]>([]);
    const [error, setError] = useState<UiMessage | null>(null);
    useEffect(() => {
        if (getToken()) studyApi.materials().then((r) => setMaterials(r?.materials ?? [])).catch(() => undefined);
    }, []);
    if (!getToken()) return <p className="p-4 text-amber-300">{t('study.loginRequired')}</p>;
    const create = () => studyApi.create().then((room) => navigate(`/study/${room.code}`))
        .catch((err) => setError(errorMessage(err, 'common.networkError')));
    return (
        <div className="w-full max-w-3xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="study-lobby">
            <header className="flex items-center gap-2">
                <Presentation className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('study.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('study.intro')}</p>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <div className="flex flex-wrap gap-3 items-end">
                <button type="button" onClick={() => void create()} data-testid="study-create"
                        className="px-4 py-2 rounded bg-amber-700 text-white font-bold">{t('study.create')}</button>
                <form className="flex gap-2 items-end" onSubmit={(e) => {
                    e.preventDefault();
                    if (code.trim()) navigate(`/study/${code.trim()}`);
                }}>
                    <label className="flex flex-col text-sm gap-1">{t('study.code')}
                        <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={12} data-testid="study-code"
                               className="bg-black/40 rounded px-2 py-1 w-36 font-mono"/>
                    </label>
                    <button type="submit" className="px-3 py-1.5 rounded bg-black/40 border border-amber-800/60">{t('study.join')}</button>
                </form>
            </div>
            {materials.length > 0 && (
                <section>
                    <h2 className="font-bold text-amber-200 mb-1">{t('study.materials')}</h2>
                    <ul className="text-sm list-disc list-inside">{materials.map((m) => <li key={m.id}>{m.title}</li>)}</ul>
                </section>
            )}
        </div>
    );
}

export function StudyRoomPage() {
    const {t} = useI18n();
    const {code = ''} = useParams<{ code: string }>();
    const [room, setRoom] = useState<StudyRoom | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [tool, setTool] = useState<Tool>('move');
    const [color, setColor] = useState<ArrowColor>('green');
    const [arrowFrom, setArrowFrom] = useState<string | null>(null);
    const [message, setMessage] = useState('');
    const [fenInput, setFenInput] = useState('');
    const [note, setNote] = useState('');
    const [steps, setSteps] = useState<Record<string, unknown>[]>([]);
    const [question, setQuestion] = useState({kind: 'choice' as 'choice' | 'move', prompt: '', options: '', correct: '0', seconds: 60});
    const [now, setNow] = useState(() => Date.now());
    const version = useRef(0);

    const apply = useCallback((next: StudyRoom | null) => {
        if (!next) return;
        version.current = next.version;
        setRoom(next);
    }, []);

    useEffect(() => {
        const tick = () => studyApi.poll(code, version.current).then(apply)
            .catch((err) => setError(errorMessage(err, 'common.networkError')));
        void tick();
        const timer = window.setInterval(() => {
            void tick();
            setNow(Date.now());
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [code, apply]);

    if (!getToken()) return <p className="p-4 text-amber-300">{t('study.loginRequired')}</p>;
    if (!room) return error ? <p role="alert" className="p-4 text-rose-300">{renderUiMessage(error, t)}</p> : null;

    const host = room.is_host;
    const board = room.board;
    const run = (action: Promise<StudyRoom | null>) => action.then(apply).catch((err) => setError(errorMessage(err, 'common.networkError')));
    const push = (next: Partial<StudyBoard>) => run(studyApi.setBoard(code, {...board, ...next}));
    const question_ = room.question;
    const open = question_ && !question_.revealed && question_.deadline * 1000 > now;
    const secondsLeft = question_ ? Math.max(0, Math.ceil(question_.deadline - now / 1000)) : 0;

    const onMove = (uci: string) => {
        if (!host) {
            if (open && question_?.kind === 'move' && room.my_answer === undefined) void run(studyApi.answer(code, uci));
            return;
        }
        const game = new Chess(board.fen);
        try {
            game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q'});
        } catch {
            return;
        }
        void push({fen: game.fen(), last_move: uci, arrows: [], highlights: [], ghost: null});
    };

    const onSquare = (square: string) => {
        if (tool === 'arrow') {
            if (!arrowFrom) {
                setArrowFrom(square);
                return;
            }
            const exists = board.arrows.some((a) => a.from === arrowFrom && a.to === square);
            const arrows = exists ? board.arrows.filter((a) => !(a.from === arrowFrom && a.to === square))
                : [...board.arrows, {from: arrowFrom, to: square, color}];
            setArrowFrom(null);
            if (arrowFrom !== square) void push({arrows});
            return;
        }
        const tone = tool === 'dark' ? 'dark' : 'light';
        const has = board.highlights.some((h) => h.square === square);
        void push({highlights: has ? board.highlights.filter((h) => h.square !== square) : [...board.highlights, {square, tone}]});
    };

    const ask = () => {
        const game = new Chess(board.fen);
        let correct: number | string[];
        let options: string[] | undefined;
        if (question.kind === 'choice') {
            options = question.options.split('\n').map((o) => o.trim()).filter(Boolean);
            correct = Number(question.correct);
        } else {
            correct = question.correct.split(/[ ,]+/).filter(Boolean).flatMap((san) => {
                try {
                    const move = new Chess(board.fen).move(san);
                    return [`${move.from}${move.to}${move.promotion ?? ''}`];
                } catch {
                    return [];
                }
            });
        }
        void run(studyApi.ask(code, {kind: question.kind, prompt: question.prompt, options, correct, seconds: question.seconds}));
        // Вопрос — и шаг урока: выбор варианта или поиск хода (формат 14.1).
        const text = {en: question.prompt, uk: question.prompt, ru: question.prompt};
        setSteps((list) => [...list, question.kind === 'choice'
            ? {type: 'choice', fen: board.fen, text, options: (options ?? []).map((o, i) => ({text: {en: o, uk: o, ru: o}, correct: i === correct}))}
            : {type: 'find_move', fen: game.fen(), text, line: [{answers: correct}]}]);
    };

    const lesson = () => sessionLesson(code, note, steps);
    const lessonReady = steps.length > 0 && lessonProblems(lesson()).length === 0;
    const hasQuestion = steps.some((s) => s.type === 'choice' || s.type === 'find_move');

    const arrows = board.arrows.map((a) => ({from: a.from, to: a.to, color: a.color}));
    const lastMove = board.last_move ? {from: board.last_move.slice(0, 2), to: board.last_move.slice(2, 4)} : null;
    const answers = Object.values(room.answers ?? {});

    return (
        <div className="w-full max-w-6xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="study-room">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link to="/study" className="text-sm text-amber-400 hover:underline">{t('study.title')}</Link>
                <span className="text-sm" data-testid="study-header">
                    {t('study.roomLine', {code: room.code, host: room.host})} · {t('study.present', {n: room.participants.length})}
                </span>
            </div>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <div className="flex flex-col lg:flex-row gap-5 items-start">
                <div className="w-full max-w-[560px] flex flex-col gap-2">
                    <PuzzleBoard fen={board.fen} orientation="white" onMove={onMove} lastMove={lastMove} arrows={arrows}
                                 interactive={host || Boolean(open && question_?.kind === 'move' && room.my_answer === undefined)}
                                 onSquare={host && tool !== 'move' ? onSquare : undefined}
                                 highlights={[...board.highlights.filter((h) => h.tone === 'light').map((h) => h.square), ...(arrowFrom ? [arrowFrom] : [])]}
                                 darkHighlights={board.highlights.filter((h) => h.tone === 'dark').map((h) => h.square)}
                                 ghost={board.ghost}/>
                    {host && (
                        <div className="flex flex-wrap gap-1.5 text-sm" data-testid="study-tools">
                            {(['move', 'arrow', 'light', 'dark'] as const).map((key) => (
                                <button key={key} type="button" aria-pressed={tool === key} onClick={() => {
                                    setTool(key);
                                    setArrowFrom(null);
                                }} data-testid={`tool-${key}`}
                                        className={`px-2 py-1 rounded border ${tool === key ? 'bg-amber-800 border-amber-400' : 'bg-black/30 border-amber-900/50'}`}>
                                    {t(`study.tools.${key}`)}
                                </button>
                            ))}
                            {tool === 'arrow' && COLORS.map((c) => (
                                <button key={c} type="button" aria-pressed={color === c} onClick={() => setColor(c)} aria-label={t(`study.colors.${c}`)}
                                        className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                                        style={{background: {green: '#16a34a', red: '#dc2626', blue: '#2563eb', yellow: '#eab308'}[c]}}/>
                            ))}
                            <button type="button" onClick={() => void push({arrows: [], highlights: [], ghost: null})}
                                    className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1">
                                <Eraser size={13}/> {t('study.clear')}
                            </button>
                        </div>
                    )}
                    {host && (
                        <form className="flex gap-2 text-sm" onSubmit={(e) => {
                            e.preventDefault();
                            if (fenInput.trim()) void push({fen: fenInput.trim(), last_move: null, arrows: [], highlights: [], ghost: null});
                        }}>
                            <input value={fenInput} onChange={(e) => setFenInput(e.target.value)} placeholder="FEN" data-testid="study-fen"
                                   className="flex-1 bg-black/40 rounded px-2 py-1 font-mono text-xs"/>
                            <button type="submit" className="px-2 py-1 rounded bg-black/40 border border-amber-800/60">{t('study.setPosition')}</button>
                        </form>
                    )}
                </div>
                <div className="flex-1 w-full flex flex-col gap-3 min-w-0 text-sm">
                    {question_ && (
                        <section className="bg-amber-900/30 border border-amber-600 rounded p-3 flex flex-col gap-2" data-testid="study-question">
                            <p className="font-bold">{question_.prompt || t(question_.kind === 'move' ? 'study.findMove' : 'study.chooseAnswer')}</p>
                            {open && <p className="font-mono text-amber-300">{t('study.secondsLeft', {n: secondsLeft})}</p>}
                            {question_.kind === 'choice' && question_.options?.map((o, i) => (
                                <button key={i} type="button" disabled={host || !open || room.my_answer !== undefined}
                                        onClick={() => void run(studyApi.answer(code, i))} data-testid={`option-${i}`}
                                        className={`text-left px-2 py-1 rounded border ${question_.revealed && question_.correct === i ? 'border-emerald-400' : 'border-amber-900/60'} bg-black/30 disabled:opacity-70`}>
                                    {o}
                                </button>
                            ))}
                            {!host && room.my_answer !== undefined && <p data-testid="study-answered">{t('study.answered')}</p>}
                            {host && (
                                <>
                                    <p data-testid="study-answers">{t('study.answers', {n: answers.length, right: answers.filter((a) => a.correct).length})}</p>
                                    {!question_.revealed && (
                                        <button type="button" onClick={() => void run(studyApi.reveal(code))} className="self-start px-2 py-1 rounded bg-amber-700 text-white">
                                            {t('study.reveal')}
                                        </button>
                                    )}
                                </>
                            )}
                        </section>
                    )}
                    {host && (
                        <section className="bg-black/30 rounded p-3 flex flex-col gap-2" data-testid="study-ask">
                            <h3 className="font-bold text-amber-200">{t('study.newQuestion')}</h3>
                            <select value={question.kind} onChange={(e) => setQuestion({...question, kind: e.target.value as 'choice' | 'move'})}
                                    className="bg-black/40 rounded px-2 py-1 self-start" data-testid="question-kind">
                                <option value="choice">{t('study.kindChoice')}</option>
                                <option value="move">{t('study.kindMove')}</option>
                            </select>
                            <input value={question.prompt} onChange={(e) => setQuestion({...question, prompt: e.target.value})}
                                   placeholder={t('study.prompt')} maxLength={300} className="bg-black/40 rounded px-2 py-1" data-testid="question-prompt"/>
                            {question.kind === 'choice' ? (
                                <>
                                    <textarea value={question.options} onChange={(e) => setQuestion({...question, options: e.target.value})} rows={3}
                                              placeholder={t('study.optionsHint')} className="bg-black/40 rounded px-2 py-1" data-testid="question-options"/>
                                    <label className="flex items-center gap-2">{t('study.correctNumber')}
                                        <input type="number" min={1} value={Number(question.correct) + 1} data-testid="question-correct"
                                               onChange={(e) => setQuestion({...question, correct: String(Math.max(0, Number(e.target.value) - 1))})}
                                               className="bg-black/40 rounded px-2 py-1 w-16"/>
                                    </label>
                                </>
                            ) : (
                                <input value={question.correct} onChange={(e) => setQuestion({...question, correct: e.target.value})}
                                       placeholder={t('study.correctMoves')} className="bg-black/40 rounded px-2 py-1 font-mono" data-testid="question-moves"/>
                            )}
                            <label className="flex items-center gap-2">{t('study.seconds')}
                                <input type="number" min={10} max={600} value={question.seconds}
                                       onChange={(e) => setQuestion({...question, seconds: Number(e.target.value)})} className="bg-black/40 rounded px-2 py-1 w-20"/>
                            </label>
                            <button type="button" onClick={ask} data-testid="question-ask" className="self-start px-3 py-1.5 rounded bg-amber-700 text-white font-bold">
                                {t('study.ask')}
                            </button>
                        </section>
                    )}
                    {host && (
                        <section className="bg-black/30 rounded p-3 flex flex-col gap-2" data-testid="study-lesson">
                            <h3 className="font-bold text-amber-200">{t('study.lesson', {n: steps.length})}</h3>
                            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('study.note')} maxLength={300}
                                   className="bg-black/40 rounded px-2 py-1" data-testid="lesson-note"/>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setSteps((list) => [...list, lessonStep(board, note)])} data-testid="lesson-add"
                                        className="px-2 py-1 rounded bg-black/40 border border-amber-800/60">{t('study.addStep')}</button>
                                <button type="button" disabled={!lessonReady} data-testid="lesson-download"
                                        onClick={() => downloadText(`regence-lesson-${code}.json`, JSON.stringify(lesson(), null, 1))}
                                        className="px-2 py-1 rounded bg-black/40 border border-amber-800/60 flex items-center gap-1 disabled:opacity-40">
                                    <Download size={13}/> {t('study.download')}
                                </button>
                                <button type="button" disabled={!lessonReady} data-testid="lesson-save"
                                        onClick={() => studyApi.saveMaterial(note || code, lesson()).then(() => setSteps([]))
                                            .catch((err) => setError(errorMessage(err, 'common.networkError')))}
                                        className="px-2 py-1 rounded bg-amber-700 text-white disabled:opacity-40">{t('study.save')}</button>
                            </div>
                            {steps.length > 0 && !lessonReady && (
                                <p className="text-xs text-amber-300" data-testid="lesson-hint">{t(hasQuestion ? 'study.lessonInvalid' : 'study.needQuestion')}</p>
                            )}
                        </section>
                    )}
                    <section className="bg-black/30 rounded p-3 flex flex-col gap-2" data-testid="study-chat">
                        <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                            {room.chat.map((m, i) => <p key={i}><span className="text-amber-300">{m.from}:</span> {m.text}</p>)}
                        </div>
                        <form className="flex gap-2" onSubmit={(e) => {
                            e.preventDefault();
                            if (message.trim()) void run(studyApi.chat(code, message)).then(() => setMessage(''));
                        }}>
                            <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} data-testid="chat-input"
                                   placeholder={t('study.chatPlaceholder')} className="flex-1 bg-black/40 rounded px-2 py-1"/>
                            <button type="submit" aria-label={t('study.send')} className="px-2 py-1 rounded bg-black/40 border border-amber-800/60"><Send size={14}/></button>
                        </form>
                    </section>
                </div>
            </div>
        </div>
    );
}
