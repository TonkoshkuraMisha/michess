// --- FILE: frontend/src/components/chessboard/HistoricalBotsPanel.tsx ---
// Выбор соперника-бота: исторические боты и мастера с портретом, годами жизни и силой (измеренной, если бот
// калиброван, — GET /bots/catalog), выбор цвета, форы и старта со своей позиции. Список ботов, портреты и годы —
// config/champions.ts; имена, титулы и девизы — каталог bots.profiles.*. С сервера приходят только числа: измеренная
// сила и сила по партиям с людьми (GET /bots/catalog), память бота об игроке (GET /bots/rivalry) — их загружает
// Chessboard. Внизу — реплика бота к последнему ходу (ключ каталога botComments.*, уже переведённый вызывающим).

import {hasGiver, ODDS} from './odds';
import type {OddsChoice, OddsGiver, OddsKind} from './odds';
import {Link} from 'react-router-dom';
import {MessageSquareQuote} from 'lucide-react';
import {HISTORICAL_BOTS_LIST} from '../../config/champions';
import type {BotOpponentId, HistoricalBotId, HistoricalBotProfile} from '../../config/champions';
import {useI18n} from '../../i18n';
import {scorePoints} from '../../services/botCatalog';
import type {BotRival} from '../../services/botCatalog';

export interface HistoricalBotsPanelProps {
    /** Бот, выбранный в списке (его карточка показана), — не обязательно тот, с кем идёт партия. */
    selectedBotId: HistoricalBotId;
    onSelectBot: (id: HistoricalBotId) => void;
    selectedBotProfile: HistoricalBotProfile;
    /** Соперник идущей (или только что сыгранной) партии с ботом; null — партии с ботом нет. */
    activeBot: BotOpponentId | null;
    activeBotProfile: HistoricalBotProfile | null;
    /** id партии с человеком: пока она идёт, начать партию с ботом нельзя. */
    gameId: number | null;
    gameOverResult: string | null;
    isBotThinking: boolean;
    /** Реплика бота на языке игрока; null — показывается общая фраза bots.defaultThought. */
    botComment: string | null;
    onStartBotGame: (botId: HistoricalBotId, colorPref: 'white' | 'black' | 'random') => void;
    /** На свободной доске стоит своя позиция — партию с ботом можно начать с неё. */
    canStartFromPosition: boolean;
    startFromPosition: boolean;
    onStartFromPositionChange: (value: boolean) => void;
    /** Измеренная сила (GET /bots/catalog): id бота → рейтинг; без калибровки — заявленный. */
    measured?: Record<string, number>;
    /** Сила по партиям с людьми (таск 32.1): id бота → рейтинг и число партий. */
    live?: Record<string, { rating: number; games: number }>;
    /** Память о сопернике (таск 32.2): id бота → партии с игроком и очки бота. */
    rivals?: Record<string, BotRival>;
    /** Фора (таск 21.1); без обработчика выбор не показывается. */
    odds?: OddsChoice;
    onOddsChange?: (odds: OddsChoice) => void;
}

/**
 * Выбор исторического бота, карточка с его девизом/рейтингом и кнопками старта партии. Фора недоступна при
 * старте со своей позиции (материальная фора сама задаёт начальную позицию).
 */
export function HistoricalBotsPanel({
    selectedBotId, onSelectBot, selectedBotProfile, activeBot, activeBotProfile, gameId,
    gameOverResult, isBotThinking, botComment, onStartBotGame,
    canStartFromPosition, startFromPosition, onStartFromPositionChange, measured = {}, live = {}, rivals = {}, odds, onOddsChange,
}: HistoricalBotsPanelProps) {
    const {t} = useI18n();
    return (
        <div
            className="flex-1 min-h-0 bg-acacia-dark p-2.5 rounded-md border border-amber-700/40 flex flex-col justify-between gap-2 shadow-inner overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-amber-900/50">
            <div className="grid grid-cols-2 gap-1.5">
                {HISTORICAL_BOTS_LIST.map((botItem) => {
                    const isSelected = selectedBotId === botItem.id;
                    return (
                        <button
                            key={botItem.id}
                            type="button"
                            onClick={() => onSelectBot(botItem.id)}
                            className={`p-1.5 rounded-md text-left transition cursor-pointer flex items-center gap-2 border ${
                                isSelected
                                    ? 'bg-amber-800/80 text-white border-amber-400 shadow'
                                    : 'bg-black/35 text-boxwood/85 border-amber-900/40 hover:border-amber-600/50 hover:bg-black/55'
                            }`}
                        >
                            <img
                                src={botItem.avatar}
                                alt={botItem.shortName}
                                onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    if (!img.src.endsWith(botItem.fallbackAvatar)) {
                                        img.src = botItem.fallbackAvatar;
                                    }
                                }}
                                className={`w-8 h-8 rounded-full object-cover shrink-0 border ${
                                    isSelected ? 'border-amber-300' : 'border-amber-700/60'
                                }`}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold truncate leading-tight">
                                    {botItem.shortName}
                                </div>
                                <div className="text-[11px] font-mono text-amber-300/90">
                                    {t('bots.eloShort', {rating: measured[botItem.id] ?? botItem.rating})}{measured[botItem.id] ? t('bots.measuredMark') : ''}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="p-2.5 rounded-md bg-black/40 border border-amber-800/50 flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                    <img
                        src={selectedBotProfile.avatar}
                        alt={selectedBotProfile.name}
                        onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (!img.src.endsWith(selectedBotProfile.fallbackAvatar)) {
                                img.src = selectedBotProfile.fallbackAvatar;
                            }
                        }}
                        className="w-12 h-12 rounded-lg object-cover border-2 border-amber-500/80 shadow-md shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                            <span className="text-sm font-bold text-amber-200 truncate">
                                {selectedBotProfile.name}
                            </span>
                            {activeBot === selectedBotProfile.id && !gameOverResult && (
                                <span
                                    className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-600/50 shrink-0">
                                    {t('bots.inGame')}
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-amber-400 font-semibold">
                            {selectedBotProfile.title}
                        </div>
                        <div className="text-[11px] text-boxwood/75 font-mono">
                            {t('bots.eraAndRating', {
                                era: selectedBotProfile.era,
                                rating: measured[selectedBotProfile.id] ?? selectedBotProfile.rating,
                            })}
                            {t(measured[selectedBotProfile.id] ? 'bots.ratingMeasured' : 'bots.ratingDeclared')}
                            {' '}
                            <Link to="/transparency" className="underline hover:text-amber-300" data-testid="bot-strength-how">
                                {t('bots.howMeasured')}
                            </Link>
                        </div>
                        {live[selectedBotProfile.id] && (
                            <div className="text-[11px] text-boxwood/75 font-mono" data-testid="bot-live-strength">
                                {t('bots.liveStrength', live[selectedBotProfile.id])}
                            </div>
                        )}
                        {rivals[selectedBotProfile.id] && (() => {
                            const rival = rivals[selectedBotProfile.id];
                            return (
                                <div className="text-[11px] text-amber-300" data-testid="bot-rivalry">
                                    {t(rival.remembers ? 'bots.remembersYou' : 'bots.metYou', {
                                        name: selectedBotProfile.shortName, games: rival.games,
                                        you: scorePoints(rival.games - rival.bot_points), bot: scorePoints(rival.bot_points),
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                </div>

                <p className="text-xs italic text-boxwood/90 leading-snug bg-black/30 p-2 rounded border border-amber-900/30">
                    {t('bots.quote', {text: selectedBotProfile.motto})}
                </p>

                {canStartFromPosition && (
                    <label className="flex items-center gap-2 text-xs text-amber-200 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={startFromPosition}
                            onChange={(e) => onStartFromPositionChange(e.target.checked)}
                            className="accent-amber-600"
                        />
                        {t('common.startFromPosition')}
                    </label>
                )}

                {odds && onOddsChange && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-amber-200" data-testid="odds-picker">
                        <label className="flex items-center gap-1.5 min-w-0">
                            {t('odds.label')}
                            <select value={odds.kind} disabled={canStartFromPosition && startFromPosition}
                                    onChange={(e) => onOddsChange({...odds, kind: e.target.value as OddsKind})}
                                    data-testid="odds-kind" className="bg-black/40 rounded px-1 py-0.5 min-w-0 max-w-[11rem] disabled:opacity-50">
                                {ODDS.map((kind) => <option key={kind} value={kind}>{t(`odds.kinds.${kind}`)}</option>)}
                            </select>
                        </label>
                        {hasGiver(odds.kind) && (
                            <select value={odds.giver} onChange={(e) => onOddsChange({...odds, giver: e.target.value as OddsGiver})}
                                    aria-label={t('odds.giver')} data-testid="odds-giver" className="bg-black/40 rounded px-1 py-0.5">
                                <option value="opponent">{t('odds.opponentGives')}</option>
                                <option value="me">{t('odds.iGive')}</option>
                            </select>
                        )}
                    </div>
                )}

                <div className="grid grid-cols-3 gap-1.5">
                    <button
                        type="button"
                        disabled={!!gameId && !gameOverResult}
                        onClick={() => onStartBotGame(selectedBotId, 'white')}
                        className="py-1.5 px-2 text-xs font-bold rounded-md bg-boxwood text-acacia-dark hover:bg-boxwood-light disabled:opacity-40 transition cursor-pointer shadow"
                    >
                        {t('common.playAsWhite')}
                    </button>
                    <button
                        type="button"
                        disabled={!!gameId && !gameOverResult}
                        onClick={() => onStartBotGame(selectedBotId, 'random')}
                        className="py-1.5 px-2 text-xs font-bold rounded-md bg-amber-700 text-white border border-amber-500/50 hover:bg-amber-600 disabled:opacity-40 transition cursor-pointer shadow"
                    >
                        {t('common.playRandom')}
                    </button>
                    <button
                        type="button"
                        disabled={!!gameId && !gameOverResult}
                        onClick={() => onStartBotGame(selectedBotId, 'black')}
                        className="py-1.5 px-2 text-xs font-bold rounded-md bg-black/70 text-amber-200 border border-amber-700/60 hover:bg-black disabled:opacity-40 transition cursor-pointer shadow"
                    >
                        {t('common.playAsBlack')}
                    </button>
                </div>
            </div>

            {activeBotProfile && (
                <div className="p-2 rounded-md bg-black/55 border border-amber-600/40 text-xs text-amber-100">
                    <div className="font-bold text-amber-400 mb-0.5 flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                            <MessageSquareQuote size={13}/> {t('bots.thought', {name: activeBotProfile.shortName})}
                        </span>
                        {isBotThinking && (
                            <span className="animate-pulse text-amber-300 font-mono text-[11px]">
                                {t('bots.thinking')}
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-boxwood-light leading-snug">
                        {botComment || t('bots.defaultThought')}
                    </div>
                </div>
            )}
        </div>
    );
}
