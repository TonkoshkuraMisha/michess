// --- FILE: frontend/src/components/tools/ToolsPage.tsx ---
// «Инструменты» (/tools, таски 16.2 и 16.4): доска с линией ходов и справочником дебютов, редактор позиции, импорт
// FEN и PGN, экспорт линии в PGN, «Найти мат» (движок, правило честной игры) и переход в анализ / партию с ботом с
// этой позиции на главной доске (таск 9.6: свободная доска принимает позицию через location.state.analyzeFen).

import {useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Chess} from 'chess.js';
import {Download, RotateCcw, Search, Undo2, Wrench} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {buildPgn, downloadText, STANDARD_FEN} from '../../services/pgnExport';
import {findMate} from '../../services/tools';
import type {MateResult} from '../../services/tools';
import {validateFen} from '../chessboard/boardUtils';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {OpeningExplorer} from '../OpeningExplorer';
import {PositionEditor} from './PositionEditor';

type Tab = 'board' | 'editor' | 'import';

/** Позиция и ходы из текста: сначала как FEN, затем как PGN (с заголовком FEN или из начальной позиции). */
export function parseImport(text: string): { fen: string; moves: string[] } | null {
    const source = text.trim();
    if (!source) return null;
    if (!source.includes('[') && !/\d\./.test(source) && validateFen(source) === null) return {fen: source, moves: []};
    const game = new Chess();
    try {
        game.loadPgn(source);
    } catch {
        return null;
    }
    const history = game.history({verbose: true});
    const fen = history.length ? history[0].before : game.fen();
    return {fen, moves: history.map((m) => `${m.from}${m.to}${m.promotion ?? ''}`)};
}

export function ToolsPage() {
    const {t} = useI18n();
    const navigate = useNavigate();
    const [tab, setTab] = useState<Tab>('board');
    const [baseFen, setBaseFen] = useState(STANDARD_FEN);
    const [moves, setMoves] = useState<string[]>([]);
    const [orientation, setOrientation] = useState<'white' | 'black'>('white');
    const [importText, setImportText] = useState('');
    const [importError, setImportError] = useState(false);
    const [mateDepth, setMateDepth] = useState(3);
    const [mate, setMate] = useState<MateResult | null>(null);
    const [mateError, setMateError] = useState<UiMessage | null>(null);
    const [searching, setSearching] = useState(false);

    const position = useMemo(() => {
        const game = new Chess(baseFen);
        let last: { from: string; to: string } | null = null;
        const sans: string[] = [];
        for (const uci of moves) {
            const move = game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
            last = {from: move.from, to: move.to};
            sans.push(move.san);
        }
        return {fen: game.fen(), last, sans};
    }, [baseFen, moves]);

    const standard = baseFen === STANDARD_FEN;
    const firstBlack = baseFen.split(' ')[1] === 'b';
    const firstNumber = Number(baseFen.split(' ')[5] ?? 1) || 1;
    const line = position.sans.map((san, i) => {
        const ply = i + (firstBlack ? 1 : 0);
        const number = firstNumber + Math.floor(ply / 2);
        return ply % 2 === 0 ? `${number}. ${san}` : (i === 0 ? `${number}… ${san}` : san);
    }).join(' ');

    const play = (uci: string) => {
        setMoves((list) => [...list, uci]);
        setMate(null);
    };
    const setLine = (fen: string, list: string[]) => {
        setBaseFen(fen);
        setMoves(list);
        setMate(null);
        setTab('board');
    };

    const doImport = () => {
        const parsed = parseImport(importText);
        setImportError(parsed === null);
        if (parsed) setLine(parsed.fen, parsed.moves);
    };

    const searchMate = async () => {
        setSearching(true);
        setMateError(null);
        setMate(null);
        try {
            setMate(await findMate(position.fen, mateDepth));
        } catch (err) {
            setMateError(errorMessage(err, 'common.networkError'));
        } finally {
            setSearching(false);
        }
    };

    const exportPgn = () => downloadText('michess-line.pgn', buildPgn({
        headers: {Site: 'Michess'}, startFen: baseFen, moves: position.sans.map((san) => ({san})),
    }));

    return (
        <div className="w-full max-w-6xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="tools-page">
            <header className="flex items-center gap-2">
                <Wrench className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('tools.title')}</h1>
            </header>
            <div className="flex gap-1.5" role="tablist">
                {(['board', 'editor', 'import'] as const).map((key) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                            data-testid={`tools-tab-${key}`}
                            className={`px-3 py-1.5 rounded text-sm border ${tab === key ? 'bg-amber-800 border-amber-400 text-white' : 'bg-black/30 border-amber-900/50 hover:border-amber-600'}`}>
                        {t(`tools.tabs.${key}`)}
                    </button>
                ))}
            </div>

            {tab === 'editor' && <PositionEditor initialFen={position.fen} onUse={(fen) => setLine(fen, [])}/>}

            {tab === 'import' && (
                <div className="flex flex-col gap-2 max-w-2xl">
                    <p className="text-sm text-boxwood/80">{t('tools.importHint')}</p>
                    <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8} data-testid="tools-import-text"
                              className="bg-black/40 rounded p-2 font-mono text-xs"/>
                    {importError && <p role="alert" className="text-sm text-rose-300">{t('tools.importFailed')}</p>}
                    <button type="button" onClick={doImport} data-testid="tools-import"
                            className="self-start px-4 py-2 rounded bg-amber-700 text-white font-bold">{t('tools.import')}</button>
                </div>
            )}

            {tab === 'board' && (
                <div className="flex flex-col lg:flex-row gap-5 items-start">
                    <div className="w-full max-w-[560px] flex flex-col gap-2">
                        <PuzzleBoard fen={position.fen} orientation={orientation} interactive onMove={play} lastMove={position.last}
                                     arrows={mate?.found ? [{from: mate.line[0].slice(0, 2), to: mate.line[0].slice(2, 4), color: 'green'}] : []}/>
                        <div className="flex flex-wrap gap-2 text-sm">
                            <button type="button" onClick={() => setMoves((list) => list.slice(0, -1))} disabled={moves.length === 0}
                                    className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1 disabled:opacity-40">
                                <Undo2 size={14}/> {t('tools.back')}
                            </button>
                            <button type="button" onClick={() => setLine(STANDARD_FEN, [])} disabled={standard && moves.length === 0}
                                    className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1 disabled:opacity-40">
                                <RotateCcw size={14}/> {t('tools.reset')}
                            </button>
                            <button type="button" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
                                    className="px-2 py-1 rounded bg-black/30 border border-amber-900/50">
                                {t('common.flipBoard')}
                            </button>
                            <button type="button" onClick={exportPgn} data-testid="tools-export"
                                    className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1">
                                <Download size={14}/> {t('tools.exportPgn')}
                            </button>
                            <button type="button" onClick={() => navigate('/', {state: {analyzeFen: position.fen}})} data-testid="tools-analyze"
                                    className="px-2 py-1 rounded bg-amber-700 text-white font-bold">
                                {t('tools.analyzeOnBoard')}
                            </button>
                        </div>
                        {line && <p className="font-mono text-xs text-boxwood/80" data-testid="tools-line">{line}</p>}
                        <div className="bg-black/30 rounded p-3 flex flex-wrap items-center gap-2 text-sm" data-testid="tools-mate">
                            <span className="font-bold text-amber-200">{t('tools.findMate')}</span>
                            <label className="flex items-center gap-1">
                                {t('tools.mateDepth')}
                                <select value={mateDepth} onChange={(e) => setMateDepth(Number(e.target.value))} className="bg-black/40 rounded px-1">
                                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </label>
                            <button type="button" onClick={() => void searchMate()} disabled={searching} data-testid="tools-mate-search"
                                    className="px-2 py-1 rounded bg-amber-700 text-white font-bold flex items-center gap-1 disabled:opacity-50">
                                <Search size={14}/> {t('tools.search')}
                            </button>
                            {mate && (
                                <p className="w-full" data-testid="tools-mate-result">
                                    {mate.found ? t('tools.mateFound', {n: mate.mate_in ?? 0, line: mate.san.join(' ')}) : t('tools.mateNotFound', {n: mateDepth})}
                                </p>
                            )}
                            {mateError && <p role="alert" className="w-full text-rose-300">{renderUiMessage(mateError, t)}</p>}
                        </div>
                    </div>
                    <div className="flex-1 w-full min-w-0">
                        {standard
                            ? <OpeningExplorer moves={moves} onPlay={play}/>
                            : <p className="text-sm text-boxwood/70" data-testid="tools-explorer-custom">{t('tools.explorerOnlyStandard')}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
