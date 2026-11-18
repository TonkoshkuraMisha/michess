// --- FILE: frontend/src/components/chessboard/LadderPanel.tsx ---
// Клубная лестница: ступени от слабого соперника к сильному, рейтинг лестницы игрока и кнопка партии со следующим
// соперником. Состояние — GET /bots/ladder, начало партии — POST /bots/ladder/start (сервер выбирает соперника и
// цвет при «случайном»). Сама партия идёт как обычная партия с ботом (useBotGame), итог приходит в ответе на её
// сохранение (/bots/save-game, поле ladder). Честность партии проверяет сервер (src/services/ladder.py): подсказка,
// анализ, возврат хода или подмена соперника — партия не засчитывается.

import {useCallback, useEffect, useState} from 'react';
import {CheckCircle2, CircleDashed, Lock, Swords} from 'lucide-react';
import {API_BASE_URL} from '../../config/api';
import {UiError, errorMessage, readApiErrorOr} from '../../services/apiErrors';
import type {PersonalityConfig} from '../../services/personalities';
import type {LadderOutcome} from './hooks/useBotGame';
import {useI18n} from '../../i18n';
import {renderUiMessage} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {ladderOpponentName} from '../../config/players';
import {getToken} from '../../services/authToken';

/** Ступень лестницы из ответа GET /bots/ladder. */
interface Rung {
    key: string;
    kind: 'historical' | 'archetype';
    /** id бота или архетипа — имя на языке игрока берётся из каталога. */
    id: string;
    rating: number;
    measured: boolean;
    /** skipped — слабее текущей, но не пройдена: соперник добавлен в лестницу ниже уже пройденного (сервер, ladder.py). */
    status: 'beaten' | 'current' | 'skipped' | 'locked';
}

/** Ответ GET /bots/ladder: рейтинг лестницы, номер текущей ступени (с нуля), все ступени. */
interface LadderState {
    rating: number;
    games: number;
    step: number;
    total: number;
    rungs: Rung[];
    active_opponent: string | null;
}

/** Соперник ступени: исторический бот (bot_id) или архетип мастерской (config — его ползунки). */
export interface LadderOpponent {
    key: string;
    kind: 'historical' | 'archetype';
    id: string;
    rating: number;
    bot_id: string | null;
    config: PersonalityConfig | null;
}

/** Ответ POST /bots/ladder/start: с кем и каким цветом играть. */
export interface LadderStart {
    opponent: LadderOpponent;
    color: 'white' | 'black';
    step: number;
    /** Итог прежней партии лестницы, начатой и брошенной: сервер засчитал её поражением. */
    forfeited: LadderOutcome | null;
}

export interface LadderPanelProps {
    /** Уже идёт партия (с человеком или ботом) — новую начать нельзя. */
    playDisabled: boolean;
    /** Сервер открыл партию: вызывающий запускает её на доске с присланным соперником и цветом. */
    onStart: (start: LadderStart) => void;
    /** Меняется после каждой сохранённой партии лестницы — панель перечитывает прогресс. */
    lastOutcome: LadderOutcome | null;
}

/**
 * Клубная лестница: отдельный рейтинг в партиях с ботами без подсказок движка и возвратов хода,
 * соперники от слабого к сильному. Партию открывает сервер — он же проверяет её честность.
 */
export function LadderPanel({playDisabled, onStart, lastOutcome}: LadderPanelProps) {
    const {t} = useI18n();
    const [state, setState] = useState<LadderState | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [starting, setStarting] = useState(false);

    const token = getToken();

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/bots/ladder`, {headers: {Authorization: `Bearer ${token}`}});
            if (!res.ok) throw new UiError(await readApiErrorOr(res, 'ladder.loadFailed'));
            setState(await res.json());
            setError(null);
        } catch (err) {
            setError(errorMessage(err, 'ladder.loadFailed'));
        }
    }, [token]);

    // Прогресс читается при открытии вкладки и заново — после каждой сохранённой партии лестницы (lastOutcome).
    useEffect(() => {
        load();
    }, [load, lastOutcome]);

    const start = async (color: 'white' | 'black' | 'random') => {
        if (!token) return;
        setStarting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/bots/ladder/start`, {
                method: 'POST',
                headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({color}),
            });
            if (!res.ok) throw new UiError(await readApiErrorOr(res, 'ladder.startFailed'));
            onStart(await res.json());
            await load();
        } catch (err) {
            setError(errorMessage(err, 'ladder.startFailed'));
        } finally {
            setStarting(false);
        }
    };

    const current = state?.rungs.find((r) => r.status === 'current');

    return (
        <div className="flex flex-col gap-2 text-xs text-boxwood" data-testid="ladder-panel">
            <p className="text-boxwood/80 leading-snug">
                {t('ladder.intro')}
            </p>
            {error && <p role="alert" className="text-red-300">{renderUiMessage(error, t)}</p>}
            {state && (
                <>
                    <div className="flex items-center justify-between p-2 rounded-md bg-black/40 border border-amber-800/50">
                        <span>{t('ladder.rating')}</span>
                        <span className="font-mono text-base text-amber-300" data-testid="ladder-rating">{state.rating}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded bg-black/50 overflow-hidden">
                            <div className="h-full bg-amber-500"
                                 style={{width: `${Math.round((Math.min(state.step, state.total) / state.total) * 100)}%`}}/>
                        </div>
                        <span className="font-mono text-amber-300/90">{Math.min(state.step, state.total)}/{state.total}</span>
                    </div>

                    {current && (
                        <div className="p-2 rounded-md bg-black/40 border border-amber-600/50 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-amber-200">{t('ladder.next', {name: ladderOpponentName(current.kind, current.id, t)})}</span>
                                <span className="font-mono text-amber-300">
                                    {current.measured ? t('common.measuredShort', {rating: current.rating}) : current.rating}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                                {(['white', 'random', 'black'] as const).map((color) => (
                                    <button key={color} type="button" disabled={playDisabled || starting}
                                            onClick={() => start(color)}
                                            className="py-1.5 font-bold rounded-md bg-amber-700 text-white hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
                                        {t(color === 'white' ? 'common.playAsWhite' : color === 'black' ? 'common.playAsBlack' : 'common.playRandom')}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <ol className="flex flex-col gap-0.5">
                        {state.rungs.map((r, i) => (
                            <li key={r.key}
                                className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${
                                    r.status === 'current' ? 'bg-amber-900/50 text-amber-100' : 'text-boxwood/80'}`}>
                                <span className="w-4 text-right font-mono text-boxwood/50">{i + 1}</span>
                                {r.status === 'beaten' ? <CheckCircle2 size={12} className="text-emerald-400" aria-label={t('ladder.beaten')}/>
                                    : r.status === 'current' ? <Swords size={12} className="text-amber-300" aria-label={t('ladder.current')}/>
                                        : r.status === 'skipped' ? <CircleDashed size={12} className="text-boxwood/60" aria-label={t('ladder.skipped')}
                                                                                 data-testid={`ladder-skipped-${r.key}`}/>
                                            : <Lock size={12} className="text-boxwood/40" aria-label={t('ladder.locked')}/>}
                                <span className="flex-1 truncate">{ladderOpponentName(r.kind, r.id, t)}</span>
                                <span className="font-mono">{r.rating}</span>
                            </li>
                        ))}
                    </ol>
                </>
            )}
        </div>
    );
}
