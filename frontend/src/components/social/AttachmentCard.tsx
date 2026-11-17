// --- FILE: frontend/src/components/social/AttachmentCard.tsx ---
// Карточка вложения личного сообщения (таск 30.1): партия, позиция, задача, урок, турнир. Позиция и задача —
// маленькой диаграммой на доске и фигурах игрока, остальное — строкой со ссылкой.

import {useMemo} from 'react';
import {Link} from 'react-router-dom';
import {Chess} from 'chess.js';
import {BookOpen, Crown, Puzzle, Swords, Trophy} from 'lucide-react';
import {useI18n} from '../../i18n';
import {BOARD_THEMES, getPieceSvgUrl, getSavedBoardThemeKey, getSavedPieceSetKey} from '../../config/boardAppearance';
import {lessonById, localized} from '../../content/lessons';
import {attachmentLink} from '../../services/messages';
import type {Attachment, AttachmentKind} from '../../services/messages';

const ICONS: Record<AttachmentKind, typeof Swords> = {game: Swords, position: Crown, puzzle: Puzzle, lesson: BookOpen, tournament: Trophy};

/** Диаграмма позиции без взаимодействия; некорректный FEN — пустая доска не рисуется вовсе. */
export function MiniDiagram({fen, size = 160}: { fen: string; size?: number }) {
    const board = useMemo(() => {
        try {
            return new Chess(fen).board();
        } catch {
            return null;
        }
    }, [fen]);
    if (!board) return null;
    const theme = BOARD_THEMES[getSavedBoardThemeKey()] ?? BOARD_THEMES.walnut;
    const pieces = getSavedPieceSetKey();
    return (
        <div className="grid grid-cols-8 rounded-sm overflow-hidden border border-black/60" style={{width: size, height: size}}
             data-testid="mini-diagram">
            {board.flatMap((row, r) => row.map((piece, f) => (
                <div key={`${r}${f}`} className="flex items-center justify-center"
                     style={{backgroundColor: (r + f) % 2 === 1 ? theme.dark : theme.light}}>
                    {piece && <img src={getPieceSvgUrl(pieces, piece.color, piece.type)} alt="" draggable={false} className="w-[88%] h-[88%]"/>}
                </div>
            )))}
        </div>
    );
}

function sideToMove(fen: string): 'w' | 'b' {
    return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

export function AttachmentCard({attachment}: { attachment: Attachment }) {
    const {t, language} = useI18n();
    const Icon = ICONS[attachment.kind];
    const link = attachmentLink(attachment);
    let line = t(`dm.kinds.${attachment.kind}`);
    if (attachment.kind === 'game' && attachment.white && attachment.black) {
        line = `${t('dm.card.game', {white: attachment.white, black: attachment.black})}${attachment.result ? ` · ${attachment.result}` : ''}`;
    } else if (attachment.kind === 'puzzle' && attachment.rating) {
        line = t('dm.card.puzzle', {rating: attachment.rating});
    } else if (attachment.kind === 'tournament' && attachment.size) {
        line = t('dm.card.tournament', {size: attachment.size});
    } else if (attachment.kind === 'lesson') {
        const lesson = lessonById(attachment.ref);
        if (lesson) line = `${t('dm.kinds.lesson')}: ${localized(lesson.title, language)}`;
    }
    const fen = attachment.kind === 'position' ? attachment.ref : attachment.fen;
    return (
        <div className="mt-1 rounded-md border border-amber-900/60 bg-black/30 p-2 flex flex-col gap-1.5 max-w-[260px]"
             data-testid={`attachment-${attachment.kind}`}>
            <span className="flex items-center gap-1.5 text-sm text-amber-100">
                <Icon size={14} className="shrink-0"/>
                <span className="break-words min-w-0">{line}</span>
            </span>
            {fen && (
                <div className="flex items-center gap-2">
                    <MiniDiagram fen={fen}/>
                    <span className={`w-3 h-3 rounded-full border border-black/60 ${sideToMove(fen) === 'w' ? 'bg-stone-100' : 'bg-stone-900'}`}/>
                </div>
            )}
            {link && (
                <Link to={link} className="self-start text-xs px-2 py-0.5 rounded bg-amber-800/80 text-white hover:bg-amber-700">
                    {t('dm.card.open')}
                </Link>
            )}
        </div>
    );
}
