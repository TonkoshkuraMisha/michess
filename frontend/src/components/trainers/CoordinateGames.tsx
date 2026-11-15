// --- FILE: frontend/src/components/trainers/CoordinateGames.tsx ---
// Тренажёры координат (таск 19.2): на время — сколько вопросов подряд верно. Доска своя, простая: поля крупные,
// касанием, без фигур; за чёрных доска перевёрнута; координаты по краю можно скрыть.

import {useEffect, useMemo, useRef, useState} from 'react';
import {useI18n} from '../../i18n';
import {BOARD_THEMES, getSavedBoardThemeKey} from '../../config/boardAppearance';
import {FILES, coordQuestion, isCorrect, levelToOptions} from '../../trainers/coordinates';
import type {CoordOptions, CoordTrainer} from '../../trainers/coordinates';

interface Props {
    trainer: CoordTrainer;
    level: number;
    seed: number;
    onFinish: (score: number, mistakes: number) => void;
}

export function CoordBoard({options, highlight, marks, onSquare}: {
    options: CoordOptions; highlight?: string | null; marks?: Record<string, 'good' | 'bad'>; onSquare?: (square: string) => void;
}) {
    const theme = BOARD_THEMES[getSavedBoardThemeKey()] ?? BOARD_THEMES.walnut;
    const ranks = options.side === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    const files = options.side === 'white' ? [...FILES] : [...FILES].reverse();
    return (
        <div className="grid grid-cols-8 w-full max-w-[420px] aspect-square rounded overflow-hidden border-2 border-black/60 select-none"
             data-testid="coord-board">
            {ranks.flatMap((rank) => files.map((file) => {
                const square = `${file}${rank}`;
                const dark = (FILES.indexOf(file) + rank - 1) % 2 === 0;
                const mark = marks?.[square];
                return (
                    <button key={square} type="button" data-square={square} onClick={() => onSquare?.(square)}
                            aria-label={options.coordinates ? square : undefined}
                            className="relative cursor-pointer"
                            style={{backgroundColor: dark ? theme.dark : theme.light}}>
                        {highlight === square && <span className="absolute inset-[12%] rounded-full bg-amber-400/80" data-testid="coord-highlight"/>}
                        {mark && <span className={`absolute inset-0 ${mark === 'good' ? 'bg-emerald-500/50' : 'bg-rose-500/50'}`}/>}
                        {options.coordinates && file === files[0] && (
                            <span className="absolute top-0.5 left-1 text-[10px] font-bold" style={{color: dark ? theme.coordDark : theme.coordLight}}>{rank}</span>
                        )}
                        {options.coordinates && rank === ranks[7] && (
                            <span className="absolute bottom-0.5 right-1 text-[10px] font-bold" style={{color: dark ? theme.coordDark : theme.coordLight}}>{file}</span>
                        )}
                    </button>
                );
            }))}
        </div>
    );
}

export function CoordinateGame({trainer, level, seed, onFinish}: Props) {
    const {t} = useI18n();
    const options = levelToOptions(level);
    const [index, setIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [mistakes, setMistakes] = useState(0);
    const [left, setLeft] = useState<number>(options.seconds);
    const [flash, setFlash] = useState<{ square: string; good: boolean } | null>(null);
    const finished = useRef(false);
    const result = useRef({score: 0, mistakes: 0});
    const question = useMemo(() => coordQuestion(trainer, seed, index), [trainer, seed, index]);

    useEffect(() => {
        const started = Date.now();
        const id = window.setInterval(() => {
            const remaining = Math.max(0, options.seconds - Math.floor((Date.now() - started) / 1000));
            setLeft(remaining);
            if (remaining === 0 && !finished.current) {
                finished.current = true;
                window.clearInterval(id);
                onFinish(result.current.score, result.current.mistakes);
            }
        }, 250);
        return () => window.clearInterval(id);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const answer = (reply: string, square = reply) => {
        if (finished.current) return;
        const good = isCorrect(question, reply);
        if (good) setScore((s) => (result.current.score = s + 1));
        else setMistakes((m) => (result.current.mistakes = m + 1));
        setFlash({square, good});
        setIndex((i) => i + 1);
    };

    const prompt = trainer === 'coord_find' ? t('trainers.coord.findPrompt', {square: question.square})
        : trainer === 'coord_name' ? t('trainers.coord.namePrompt')
            : trainer === 'coord_color' ? t('trainers.coord.colorPrompt', {square: question.square})
                : t('trainers.coord.diagonalPrompt', {square: question.square});

    return (
        <div className="flex flex-col gap-3 items-start" data-testid="coord-game">
            <div className="flex flex-wrap items-baseline gap-4">
                <span className="text-3xl font-bold text-amber-200" data-testid="coord-prompt">{prompt}</span>
                <span className="font-mono text-lg" data-testid="coord-left">{t('trainers.coord.left', {seconds: left})}</span>
                <span className="text-emerald-300" data-testid="coord-score">{t('trainers.coord.score', {score, mistakes})}</span>
            </div>
            {trainer === 'coord_color' ? (
                <div className="flex gap-3">
                    {(['light', 'dark'] as const).map((color) => (
                        <button key={color} type="button" data-testid={`coord-${color}`} onClick={() => answer(color)}
                                className={`w-32 h-20 rounded-lg border-2 border-black/50 text-lg font-bold ${color === 'light' ? 'bg-[#F0D9B5] text-acacia-dark' : 'bg-[#966C46] text-white'}`}>
                            {t(`trainers.coord.${color}`)}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col sm:flex-row gap-4 items-start w-full">
                    <CoordBoard options={options}
                                highlight={trainer === 'coord_name' || trainer === 'coord_diagonal' ? question.square : null}
                                marks={flash ? {[flash.square]: flash.good ? 'good' : 'bad'} : undefined}
                                onSquare={trainer === 'coord_find' ? (square) => answer(square) : undefined}/>
                    {question.options.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                            {question.options.map((option) => (
                                <button key={option} type="button" data-testid={`coord-option-${option}`} onClick={() => answer(option, option)}
                                        className="px-5 py-3 rounded-lg bg-black/40 border border-amber-800/60 font-mono text-xl font-bold hover:border-amber-400">
                                    {option}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/** Настройки попытки вместо уровня: сторона, координаты, время. */
export function CoordOptionsPicker({value, onChange}: { value: CoordOptions; onChange: (value: CoordOptions) => void }) {
    const {t} = useI18n();
    const button = (active: boolean) => `px-3 py-1.5 rounded border text-sm ${active ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/35 border-amber-900/50'}`;
    return (
        <div className="flex flex-wrap gap-3 items-center" data-testid="coord-options">
            <div className="flex gap-1">
                {(['white', 'black'] as const).map((side) => (
                    <button key={side} type="button" className={button(value.side === side)} data-testid={`coord-side-${side}`}
                            onClick={() => onChange({...value, side})}>{t(`trainers.coord.side.${side}`)}</button>
                ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={value.coordinates} data-testid="coord-show"
                       onChange={(e) => onChange({...value, coordinates: e.target.checked})}/>
                {t('trainers.coord.showCoordinates')}
            </label>
            <div className="flex gap-1">
                {([30, 60] as const).map((seconds) => (
                    <button key={seconds} type="button" className={button(value.seconds === seconds)} data-testid={`coord-seconds-${seconds}`}
                            onClick={() => onChange({...value, seconds})}>{t('trainers.coord.seconds', {seconds})}</button>
                ))}
            </div>
        </div>
    );
}
