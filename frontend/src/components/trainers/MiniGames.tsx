// --- FILE: frontend/src/components/trainers/MiniGames.tsx ---
// Игры тренеров (таск 19.8): /train/games — пять учебных игр с упрощёнными правилами; /train/games/:id — партия против
// бота (за белых или за чёрных), вдвоём за одним устройством или с другом по ссылке (комната — MiniGameRoom.tsx). Правила и бот — на сервере (src/services/mini_games.py):
// клиент присылает позицию и ход щелчками «откуда» — «куда», сервер проверяет ход и подводит итог. Первая победа над
// ботом записывается в прогресс уроков (miniProgressId) — по ней засчитывается шаг курса.
// Данные: сервер — src/api/mini_games.py (/api/v1/mini-games/{игра}/move и /bot-first), правила — src/services/mini_games.py. Подключено в App.tsx.

import {useEffect, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, Link2, Swords} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {errorMessage} from '../../services/apiErrors';
import {postMiniGame} from '../../services/miniGames';
import {getToken} from '../../services/authToken';
import {saveLessonProgress} from '../../services/lessonProgress';
import {miniRoomsApi} from '../../services/miniGameRooms';

/** Коды игр — те же, что знает сервер (src/services/mini_games.py); порядок — порядок карточек. */
export const MINI_GAMES = ['pawn_war', 'king_pawns', 'queen_vs_pawns', 'rook_vs_pawns', 'capture_flag'] as const;
export type MiniGameId = typeof MINI_GAMES[number];
/** Стартовые позиции игр; должны совпадать с src/services/mini_games.py. */
const START: Record<MiniGameId, string> = {
    pawn_war: '8/pppppppp/8/8/8/8/PPPPPPPP/8 w - - 0 1',
    king_pawns: '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1',
    queen_vs_pawns: '8/pppppppp/8/8/8/8/8/3Q4 w - - 0 1',
    rook_vs_pawns: '8/pppp4/8/8/8/8/8/7R w - - 0 1',
    capture_flag: '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1',
};

/** Режим партии: игрок за белых против бота, игрок за чёрных против бота или двое за одним устройством. */
type Mode = 'bot-white' | 'bot-black' | 'hotseat';

/** Запись прогресса игры тренера: lesson_progress «mini-<id>», выполнена после первой победы над ботом. */
export function miniProgressId(id: string): string {
    return `mini-${id.replace(/_/g, '-')}`;
}

/** Карточки пяти игр. */
export function MiniGamesPage() {
    const {t} = useI18n();
    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="mini-games">
            <Link to="/train" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('trainers.title')}</Link>
            <header className="flex items-center gap-2">
                <Swords className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('miniGames.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('miniGames.intro')}</p>
            <div className="grid sm:grid-cols-2 gap-3">
                {MINI_GAMES.map((id) => (
                    <Link key={id} to={`/train/games/${id}`} data-testid={`mini-${id}`}
                          className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark hover:border-amber-500 flex flex-col gap-1">
                        <span className="font-bold text-amber-200">{t(`miniGames.games.${id}.title`)}</span>
                        <span className="text-sm text-boxwood/80">{t(`miniGames.games.${id}.rules`)}</span>
                    </Link>
                ))}
            </div>
        </div>
    );
}

/** Партия: ход щелчками «откуда» — «куда», проверку и ответ бота делает сервер; победа над ботом записывается в прогресс. */
export function MiniGamePage() {
    const {t} = useI18n();
    const {gameId = ''} = useParams<{ gameId: string }>();
    const navigate = useNavigate();
    const id = (MINI_GAMES as readonly string[]).includes(gameId) ? gameId as MiniGameId : null;
    const [mode, setMode] = useState<Mode>('bot-white');
    const [fen, setFen] = useState(id ? START[id] : '');
    const [result, setResult] = useState<string | null>(null);
    const [from, setFrom] = useState<string | null>(null);
    const [last, setLast] = useState<{ from: string; to: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);

    const restart = (nextMode: Mode) => {
        if (!id) return;
        setMode(nextMode);
        setFen(START[id]);
        setResult(null);
        setFrom(null);
        setLast(null);
        setError(null);
        if (nextMode === 'bot-black') {
            setBusy(true);
            postMiniGame(`/${id}/bot-first`, {fen: START[id]}).then((r) => {
                setFen(r.fen);
                setResult(r.result);
                if (r.bot_move) setLast({from: r.bot_move.slice(0, 2), to: r.bot_move.slice(2, 4)});
            }).catch((err) => setError(errorMessage(err, 'common.networkError'))).finally(() => setBusy(false));
        }
    };
    useEffect(() => restart('bot-white'), [id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!id) return <p className="p-4 text-rose-300">{t('miniGames.notFound')}</p>;
    const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
    const mySide = mode === 'bot-black' ? 'black' : 'white';
    const canMove = !result && !busy && (mode === 'hotseat' || turn === mySide);

    const onSquare = (square: string) => {
        if (!canMove) return;
        if (!from) {
            setFrom(square);
            return;
        }
        if (from === square) {
            setFrom(null);
            return;
        }
        const move = `${from}${square}`;
        setFrom(null);
        setBusy(true);
        setError(null);
        postMiniGame(`/${id}/move`, {fen, move, bot: mode !== 'hotseat'}).then((r) => {
            setFen(r.fen);
            setResult(r.result);
            // Победа над ботом засчитывает шаг курса и программы (автозачёт, services/courseProgress.ts).
            const token = getToken();
            if (token && mode !== 'hotseat' && r.result === (mySide === 'white' ? '1-0' : '0-1')) {
                saveLessonProgress(token, miniProgressId(id), {step: 0, steps_total: 1, completed: true}).catch(() => undefined);
            }
            setLast(r.bot_move ? {from: r.bot_move.slice(0, 2), to: r.bot_move.slice(2, 4)} : {from: move.slice(0, 2), to: move.slice(2, 4)});
        }).catch((err) => setError(errorMessage(err, 'common.networkError'))).finally(() => setBusy(false));
    };

    const outcome = result === '1/2-1/2' ? t('miniGames.draw') : result
        ? t(result === '1-0' ? 'miniGames.whiteWins' : 'miniGames.blackWins') : null;

    return (
        <div className="w-full max-w-5xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="mini-game">
            <Link to="/train/games" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('miniGames.title')}</Link>
            <div>
                <h1 className="text-2xl font-bold text-amber-200">{t(`miniGames.games.${id}.title`)}</h1>
                <p className="text-boxwood/85">{t(`miniGames.games.${id}.rules`)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
                {(['bot-white', 'bot-black', 'hotseat'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => restart(m)} data-testid={`mini-mode-${m}`}
                            className={`px-3 py-1.5 rounded border text-sm ${mode === m ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/35 border-amber-900/50'}`}>
                        {t(`miniGames.modes.${m === 'bot-white' ? 'botWhite' : m === 'bot-black' ? 'botBlack' : 'hotseat'}`)}
                    </button>
                ))}
                {/* С другом по сети (19.8): комната на двоих, цвет — случайно; только вошедшим. */}
                <button type="button" disabled={!getToken()} data-testid="mini-mode-online"
                        title={getToken() ? undefined : t('miniGames.room.loginToCreate')}
                        onClick={() => miniRoomsApi.create(id).then((r) => navigate(`/train/games/room/${r.code}`))
                            .catch((err) => setError(errorMessage(err, 'common.networkError')))}
                        className="px-3 py-1.5 rounded border text-sm bg-black/35 border-amber-900/50 flex items-center gap-1 disabled:opacity-50">
                    <Link2 size={14}/> {t('miniGames.room.online')}
                </button>
            </div>
            <p className="font-bold" data-testid="mini-status">
                {outcome ?? (busy ? t('miniGames.thinking') : t(turn === 'white' ? 'miniGames.whiteToMove' : 'miniGames.blackToMove'))}
            </p>
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            <div className="w-full max-w-[480px]">
                <PuzzleBoard fen={fen} orientation={mode === 'bot-black' ? 'black' : 'white'} interactive onMove={() => undefined}
                             onSquare={onSquare} highlights={from ? [from] : []} lastMove={last}/>
            </div>
        </div>
    );
}
