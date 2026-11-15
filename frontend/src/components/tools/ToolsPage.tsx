// --- FILE: frontend/src/components/tools/ToolsPage.tsx ---
// «Инструменты» (/tools): пока — справочник дебютов на доске (таск 16.2). Ходы делаются на доске или щелчком по
// строке справочника; редактор позиции и импорт — таск 16.4.

import {useMemo, useState} from 'react';
import {Chess} from 'chess.js';
import {RotateCcw, Undo2, Wrench} from 'lucide-react';
import {useI18n} from '../../i18n';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {OpeningExplorer} from '../OpeningExplorer';

export function ToolsPage() {
    const {t} = useI18n();
    const [moves, setMoves] = useState<string[]>([]);
    const [orientation, setOrientation] = useState<'white' | 'black'>('white');

    const position = useMemo(() => {
        const game = new Chess();
        let last: { from: string; to: string } | null = null;
        const sans: string[] = [];
        for (const uci of moves) {
            const move = game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
            last = {from: move.from, to: move.to};
            sans.push(move.san);
        }
        return {fen: game.fen(), last, sans};
    }, [moves]);

    const play = (uci: string) => setMoves((list) => [...list, uci]);
    const line = position.sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');

    return (
        <div className="w-full max-w-6xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="tools-page">
            <header className="flex items-center gap-2">
                <Wrench className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('tools.title')}</h1>
            </header>
            <div className="flex flex-col lg:flex-row gap-5 items-start">
                <div className="w-full max-w-[560px] flex flex-col gap-2">
                    <PuzzleBoard fen={position.fen} orientation={orientation} interactive onMove={play} lastMove={position.last}/>
                    <div className="flex flex-wrap gap-2 text-sm">
                        <button type="button" onClick={() => setMoves((list) => list.slice(0, -1))} disabled={moves.length === 0}
                                className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1 disabled:opacity-40">
                            <Undo2 size={14}/> {t('tools.back')}
                        </button>
                        <button type="button" onClick={() => setMoves([])} disabled={moves.length === 0}
                                className="px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1 disabled:opacity-40">
                            <RotateCcw size={14}/> {t('tools.reset')}
                        </button>
                        <button type="button" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
                                className="px-2 py-1 rounded bg-black/30 border border-amber-900/50">
                            {t('common.flipBoard')}
                        </button>
                    </div>
                    {line && <p className="font-mono text-xs text-boxwood/80" data-testid="tools-line">{line}</p>}
                </div>
                <div className="flex-1 w-full min-w-0">
                    <OpeningExplorer moves={moves} onPlay={play}/>
                </div>
            </div>
        </div>
    );
}
