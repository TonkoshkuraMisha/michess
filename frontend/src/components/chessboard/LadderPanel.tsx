// --- FILE: frontend/src/components/chessboard/LadderPanel.tsx ---

import {useCallback, useEffect, useState} from 'react';
import {CheckCircle2, Lock, Swords} from 'lucide-react';
import {API_BASE_URL} from '../../config/api';
import {readErrorDetail} from '../../services/apiErrors';
import type {PersonalityConfig} from '../../services/personalities';
import type {LadderOutcome} from './hooks/useBotGame';

interface Rung {
    key: string;
    kind: 'historical' | 'archetype';
    name: string;
    rating: number;
    measured: boolean;
    status: 'beaten' | 'current' | 'locked';
}

interface LadderState {
    rating: number;
    games: number;
    step: number;
    total: number;
    rungs: Rung[];
    active_opponent: string | null;
}

export interface LadderOpponent {
    key: string;
    kind: 'historical' | 'archetype';
    name: string;
    rating: number;
    bot_id: string | null;
    bio: string | null;
    config: PersonalityConfig | null;
}

export interface LadderStart {
    opponent: LadderOpponent;
    color: 'white' | 'black';
    step: number;
    forfeited: LadderOutcome | null;
}

export interface LadderPanelProps {
    playDisabled: boolean;
    onStart: (start: LadderStart) => void;
    /** Меняется после каждой сохранённой партии лестницы — панель перечитывает прогресс. */
    lastOutcome: LadderOutcome | null;
}

/**
 * Клубная лестница: отдельный рейтинг в партиях с ботами без подсказок движка и возвратов хода,
 * соперники от слабого к сильному. Партию открывает сервер — он же проверяет её честность.
 */
export function LadderPanel({playDisabled, onStart, lastOutcome}: LadderPanelProps) {
    const [state, setState] = useState<LadderState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);

    const token = localStorage.getItem('token');

    const load = useCallback(async () => {
        if (!token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/bots/ladder`, {headers: {Authorization: `Bearer ${token}`}});
            if (!res.ok) throw new Error(await readErrorDetail(res, 'Не удалось загрузить лестницу'));
            setState(await res.json());
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        }
    }, [token]);

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
            if (!res.ok) throw new Error(await readErrorDetail(res, 'Не удалось начать партию'));
            onStart(await res.json());
            await load();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setStarting(false);
        }
    };

    const current = state?.rungs.find((r) => r.status === 'current');

    return (
        <div className="flex flex-col gap-2 text-xs text-boxwood" data-testid="ladder-panel">
            <p className="text-boxwood/80 leading-snug">
                Отдельный рейтинг партий с ботами — без подсказок движка и возвратов хода. Победа над
                текущим соперником открывает следующего.
            </p>
            {error && <p role="alert" className="text-red-300">{error}</p>}
            {state && (
                <>
                    <div className="flex items-center justify-between p-2 rounded-md bg-black/40 border border-amber-800/50">
                        <span>Рейтинг лестницы</span>
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
                                <span className="font-bold text-amber-200">Следующий: {current.name}</span>
                                <span className="font-mono text-amber-300">
                                    {current.rating}{current.measured ? ' (изм.)' : ''}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                                {(['white', 'random', 'black'] as const).map((color) => (
                                    <button key={color} type="button" disabled={playDisabled || starting}
                                            onClick={() => start(color)}
                                            className="py-1.5 font-bold rounded-md bg-amber-700 text-white hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
                                        {color === 'white' ? '♔ Белыми' : color === 'black' ? '♚ Чёрными' : '🎲 Случайно'}
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
                                {r.status === 'beaten' ? <CheckCircle2 size={12} className="text-emerald-400" aria-label="пройден"/>
                                    : r.status === 'current' ? <Swords size={12} className="text-amber-300" aria-label="текущий"/>
                                        : <Lock size={12} className="text-boxwood/40" aria-label="закрыт"/>}
                                <span className="flex-1 truncate">{r.name}</span>
                                <span className="font-mono">{r.rating}</span>
                            </li>
                        ))}
                    </ol>
                </>
            )}
        </div>
    );
}
