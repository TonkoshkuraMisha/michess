// --- FILE: frontend/src/components/chessboard/BlindfoldPanel.tsx ---
// Игра вслепую (таск 19.5): до партии — выбор ступени (для партий без рейтинга); в партии — «Подсмотреть», счёт
// подсмотров, ввод хода нотацией и скрытие списка ходов. Состояние (выбранная ступень, ступень партии, подсмотры)
// — общий стор config/blindfold.ts; выбранная ступень запоминается в localStorage (regence_blindfold_level).
// Какие фигуры скрыты, решает Chessboard (visibleSquares). Ступень и число подсмотров уходят в архив при сохранении
// партии с ботом (/bots/save-game) или отметкой POST /profile/games/{id}/blindfold после товарищеской партии.

import {useState} from 'react';
import {EyeOff, Eye} from 'lucide-react';
import {useI18n} from '../../i18n';
import {BLINDFOLD_LEVELS, armBlindfold, peek, setHideMoves, useBlindfold} from '../../config/blindfold';
import type {BlindfoldLevel} from '../../config/blindfold';

// Ступень → ключ подписи в каталоге (blindfold.levels.*).
const LEVEL_KEYS = {1: 'own', 2: 'fade', 3: 'pawns', 4: 'full'} as const;

/**
 * Панель игры вслепую. inGame — идёт партия (с ботом или человеком); myTurn — сейчас ход игрока (иначе поле
 * ввода отключено); onMoveInput получает набранный ход и возвращает false, если такого хода в позиции нет.
 * Вне партии или в обычной партии показывает только выбор ступени для следующей партии.
 */
export function BlindfoldPanel({inGame, myTurn, onMoveInput}: {
    inGame: boolean; myTurn: boolean; onMoveInput: (text: string) => boolean;
}) {
    const {t} = useI18n();
    const blind = useBlindfold();
    const [text, setText] = useState('');
    const [error, setError] = useState(false);
    const peeking = blind.peekUntil > Date.now();

    if (!inGame || blind.level === 0) {
        return (
            <label className="flex flex-wrap items-center gap-2 text-xs text-amber-200" data-testid="blindfold-arm">
                <EyeOff size={13}/> {t('blindfold.label')}
                <select value={blind.armed} onChange={(e) => armBlindfold(Number(e.target.value) as BlindfoldLevel)}
                        className="bg-black/40 rounded px-1 py-0.5 text-boxwood-light" data-testid="blindfold-level" disabled={inGame}>
                    <option value={0}>{t('blindfold.off')}</option>
                    {BLINDFOLD_LEVELS.map((level) => <option key={level} value={level}>{t(`blindfold.levels.${LEVEL_KEYS[level as 1 | 2 | 3 | 4]}`)}</option>)}
                </select>
                {blind.armed > 0 && <span className="text-boxwood/60">{t('blindfold.unratedOnly')}</span>}
            </label>
        );
    }

    return (
        <div className="flex flex-col gap-2 bg-black/30 border border-amber-900/50 rounded-md p-2 text-sm" data-testid="blindfold-panel">
            <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-amber-200 flex items-center gap-1"><EyeOff size={14}/> {t(`blindfold.levels.${LEVEL_KEYS[blind.level as 1 | 2 | 3 | 4]}`)}</span>
                <button type="button" onClick={() => peek()} disabled={peeking} data-testid="blindfold-peek"
                        className="px-2 py-1 rounded bg-amber-800 text-white text-xs flex items-center gap-1 disabled:opacity-50">
                    <Eye size={12}/> {t('blindfold.peek')}
                </button>
                <span className="text-xs text-boxwood/75" data-testid="blindfold-peeks">{t('blindfold.peeks', {n: blind.peeks})}</span>
                <label className="flex items-center gap-1 text-xs ml-auto">
                    <input type="checkbox" checked={blind.hideMoves} onChange={(e) => setHideMoves(e.target.checked)} data-testid="blindfold-hide-moves"/>
                    {t('blindfold.hideMoves')}
                </label>
            </div>
            <form className="flex gap-2" onSubmit={(e) => {
                e.preventDefault();
                const ok = onMoveInput(text);
                setError(!ok);
                if (ok) setText('');
            }}>
                <input value={text} onChange={(e) => setText(e.target.value)} disabled={!myTurn} data-testid="blindfold-move-input"
                       placeholder={t('blindfold.movePlaceholder')} aria-label={t('blindfold.moveLabel')}
                       className={`flex-1 bg-black/40 rounded px-2 py-1 font-mono ${error ? 'ring-1 ring-rose-500' : ''}`}/>
                <button type="submit" disabled={!myTurn || !text.trim()} className="px-3 py-1 rounded bg-amber-700 text-white disabled:opacity-50">
                    {t('blindfold.move')}
                </button>
            </form>
            {error && <span className="text-xs text-rose-300" role="alert">{t('blindfold.badMove')}</span>}
        </div>
    );
}
