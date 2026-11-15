// Дебютный репертуар (таск 20.1). /repertoire — свои репертуары, новый пустой за белых или за чёрных и шесть
// стартовых наборов с вводными текстами. /repertoire/:id — дерево линий: доска стороной репертуара, ходы из текущей
// позиции (свои — первыми), новые ходы на доске и из справочника дебютов добавляются кнопкой, импорт PGN,
// комментарий к ходу и удаление хода вместе с ветками за ним.

import {useEffect, useMemo, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {Chess} from 'chess.js';
import {ArrowLeft, BookMarked, RotateCcw, Trash2, Undo2} from 'lucide-react';
import {renderUiMessage, useI18n} from '../../i18n';
import type {UiMessage} from '../../i18n';
import {errorMessage} from '../../services/apiErrors';
import {getToken} from '../../services/authToken';
import {edgesFrom, followLine, repertoireApi} from '../../services/repertoire';
import type {Repertoire, RepertoireColor, RepertoireSummary, Starter} from '../../services/repertoire';
import {PuzzleBoard} from '../puzzles/PuzzleBoard';
import {OpeningExplorer} from '../OpeningExplorer';

const BUTTON = 'px-2 py-1 rounded bg-black/30 border border-amber-900/50 flex items-center gap-1 disabled:opacity-40';

/** Ходы линии SAN с номерами ходов из начальной позиции: «1. e4», «e5», «2. Nf3»… */
export function numbered(sans: string[]): string[] {
    return sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san));
}

export function RepertoireListPage() {
    const {t, tp} = useI18n();
    const navigate = useNavigate();
    const logged = Boolean(getToken());
    const [list, setList] = useState<RepertoireSummary[]>([]);
    const [starters, setStarters] = useState<Starter[]>([]);
    const [name, setName] = useState('');
    const [color, setColor] = useState<RepertoireColor>('white');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UiMessage | null>(null);

    useEffect(() => {
        let alive = true;
        repertoireApi.starters().then((r) => alive && setStarters(r.starters)).catch(() => undefined);
        if (logged) {
            repertoireApi.list().then((r) => alive && setList(r.repertoires))
                .catch((err) => alive && setError(errorMessage(err, 'common.networkError')));
        }
        return () => {
            alive = false;
        };
    }, [logged]);

    const create = async (body: Parameters<typeof repertoireApi.create>[0]) => {
        setBusy(true);
        setError(null);
        try {
            const created = await repertoireApi.create(body);
            navigate(`/repertoire/${created.id}`);
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
            setBusy(false);
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="repertoire-list">
            <header className="flex items-center gap-2">
                <BookMarked className="text-amber-400"/>
                <h1 className="text-2xl font-bold text-amber-200">{t('repertoire.title')}</h1>
            </header>
            <p className="text-boxwood/85">{t('repertoire.intro')}</p>
            {!logged && <p className="text-amber-300" data-testid="repertoire-login">{t('repertoire.loginRequired')}</p>}
            {error && <p role="alert" className="text-rose-300">{renderUiMessage(error, t)}</p>}

            {logged && (
                <section className="flex flex-col gap-2">
                    <h2 className="font-bold text-amber-200">{t('repertoire.mine')}</h2>
                    {list.length === 0 && <p className="text-sm text-boxwood/70">{t('repertoire.empty')}</p>}
                    <div className="grid sm:grid-cols-2 gap-2">
                        {list.map((r) => (
                            <Link key={r.id} to={`/repertoire/${r.id}`} data-testid={`repertoire-${r.id}`}
                                  className="bg-acacia p-3 rounded-lg border-2 border-acacia-dark hover:border-amber-500 flex flex-col">
                                <span className="font-bold text-amber-200 break-words">
                                    {r.name || (r.starter ? t(`repertoire.starters.${r.starter}.name`) : t('repertoire.untitled'))}
                                </span>
                                <span className="text-sm text-boxwood/80">{t(`repertoire.colors.${r.color}`)} · {tp('repertoire.movesCount', r.moves)}</span>
                            </Link>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 bg-black/30 rounded-lg p-3 text-sm">
                        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('repertoire.namePlaceholder')}
                               aria-label={t('repertoire.namePlaceholder')} data-testid="repertoire-name"
                               className="bg-black/40 rounded px-2 py-1 min-w-0 flex-1"/>
                        <select value={color} onChange={(e) => setColor(e.target.value as RepertoireColor)} aria-label={t('repertoire.side')}
                                data-testid="repertoire-color" className="bg-black/40 rounded px-1 py-1">
                            <option value="white">{t('repertoire.colors.white')}</option>
                            <option value="black">{t('repertoire.colors.black')}</option>
                        </select>
                        <button type="button" disabled={busy} onClick={() => void create({name, color})} data-testid="repertoire-create"
                                className="px-3 py-1 rounded bg-amber-700 text-white font-bold disabled:opacity-50">
                            {t('repertoire.create')}
                        </button>
                    </div>
                </section>
            )}

            <section className="flex flex-col gap-2">
                <h2 className="font-bold text-amber-200">{t('repertoire.startersTitle')}</h2>
                <p className="text-sm text-boxwood/80">{t('repertoire.startersHint')}</p>
                <div className="grid sm:grid-cols-2 gap-3">
                    {starters.map((s) => (
                        <div key={s.id} className="bg-acacia p-4 rounded-lg border-2 border-acacia-dark flex flex-col gap-1.5" data-testid={`starter-${s.id}`}>
                            <span className="font-bold text-amber-200">{t(`repertoire.starters.${s.id}.name`)}</span>
                            <span className="text-xs text-amber-300">
                                {t(`repertoire.colors.${s.color}`)} · {t(`repertoire.levels.${s.level}`)} · {tp('repertoire.linesCount', s.lines.length)}
                            </span>
                            <span className="text-sm text-boxwood/85">{t(`repertoire.starters.${s.id}.intro`)}</span>
                            {logged && (
                                <button type="button" disabled={busy} onClick={() => void create({starter: s.id})} data-testid={`starter-use-${s.id}`}
                                        className="self-start mt-1 px-3 py-1 rounded bg-amber-700 text-white text-sm font-bold disabled:opacity-50">
                                    {t('repertoire.useStarter')}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

export function RepertoireEditorPage() {
    const {t, tp} = useI18n();
    const navigate = useNavigate();
    const {repertoireId = ''} = useParams<{ repertoireId: string }>();
    const id = Number(repertoireId);
    const [rep, setRep] = useState<Repertoire | null>(null);
    const [line, setLine] = useState<string[]>([]);
    const [name, setName] = useState('');
    const [comment, setComment] = useState('');
    const [pgn, setPgn] = useState('');
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<UiMessage | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        repertoireApi.get(id).then((r) => {
            if (!alive) return;
            setRep(r);
            setName(r.name);
        }).catch((err) => alive && setError(errorMessage(err, 'common.networkError')));
        return () => {
            alive = false;
        };
    }, [id]);

    const position = useMemo(() => {
        const game = new Chess();
        const sans: string[] = [];
        let last: { from: string; to: string } | null = null;
        for (const uci of line) {
            const move = game.move({from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4]});
            sans.push(move.san);
            last = {from: move.from, to: move.to};
        }
        return {fen: game.fen(), sans, last};
    }, [line]);

    const follow = rep ? followLine(rep, line) : {position: '', known: 0};
    const inTree = follow.known === line.length;
    const children = rep && inTree ? edgesFrom(rep, follow.position) : [];
    const parent = rep && inTree && line.length > 0 ? followLine(rep, line.slice(0, -1)).position : null;
    const current = rep && parent !== null
        ? rep.moves.find((m) => m.position === parent && m.uci === line[line.length - 1]) ?? null
        : null;

    useEffect(() => setComment(current?.comment ?? ''), [current?.position, current?.uci, current?.comment]);

    if (error && !rep) return <p role="alert" className="p-4 text-rose-300">{renderUiMessage(error, t)}</p>;
    if (!rep) return <p className="p-4 text-boxwood/70">{t('repertoire.loading')}</p>;

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            await action();
        } catch (err) {
            setError(errorMessage(err, 'common.networkError'));
        } finally {
            setBusy(false);
        }
    };
    const play = (uci: string) => setLine((list) => [...list, uci]);
    const addNew = () => run(async () => {
        const result = await repertoireApi.addLine(rep.id, line);
        setRep(result);
        setNotice(tp('repertoire.added', result.added));
    });
    const importPgn = () => run(async () => {
        const result = await repertoireApi.importPgn(rep.id, pgn);
        setRep(result);
        setPgn('');
        setNotice(tp('repertoire.added', result.added));
    });
    const saveComment = () => current && run(async () => {
        const saved = await repertoireApi.comment(rep.id, current.position, current.uci, comment);
        setRep({...rep, moves: rep.moves.map((m) => (m === current ? {...m, comment: saved.comment} : m))});
    });
    const removeCurrent = () => current && window.confirm(t('repertoire.removeConfirm', {move: current.san})) && run(async () => {
        const result = await repertoireApi.removeMove(rep.id, current.position, current.uci);
        setRep(result);
        setLine((list) => list.slice(0, -1));
        setNotice(tp('repertoire.removed', result.removed));
    });
    const rename = () => run(async () => {
        const saved = await repertoireApi.rename(rep.id, name);
        setRep({...rep, name: saved.name});
    });
    const removeAll = () => window.confirm(t('repertoire.deleteConfirm')) && run(async () => {
        await repertoireApi.remove(rep.id);
        navigate('/repertoire');
    });

    const tokens = numbered(position.sans);
    const knownText = tokens.slice(0, follow.known).join(' ');
    const fresh = tokens.slice(follow.known);

    return (
        <div className="w-full max-w-6xl mx-auto p-3 flex flex-col gap-4 text-boxwood-light" data-testid="repertoire-editor">
            <Link to="/repertoire" className="text-sm text-amber-400 hover:underline flex items-center gap-1"><ArrowLeft size={14}/> {t('repertoire.title')}</Link>
            <header className="flex flex-wrap items-center gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="repertoire-rename"
                       placeholder={rep.starter ? t(`repertoire.starters.${rep.starter}.name`) : t('repertoire.untitled')}
                       aria-label={t('repertoire.namePlaceholder')}
                       className="bg-black/40 rounded px-2 py-1 text-xl font-bold text-amber-200 min-w-0 flex-1"/>
                <button type="button" onClick={() => void rename()} disabled={busy || !name.trim() || name.trim() === rep.name} className={BUTTON}>
                    {t('repertoire.save')}
                </button>
                <span className="text-sm text-boxwood/80">{t(`repertoire.colors.${rep.color}`)} · {tp('repertoire.movesCount', rep.moves.length)}</span>
                <button type="button" onClick={() => void removeAll()} disabled={busy} data-testid="repertoire-delete" className={`${BUTTON} text-rose-300`}>
                    <Trash2 size={14}/> {t('repertoire.delete')}
                </button>
            </header>
            {rep.starter && <p className="text-sm text-boxwood/85">{t(`repertoire.starters.${rep.starter}.intro`)}</p>}
            {error && <p role="alert" className="text-sm text-rose-300">{renderUiMessage(error, t)}</p>}
            {notice && <p className="text-sm text-emerald-300" data-testid="repertoire-notice">{notice}</p>}

            <div className="flex flex-col lg:flex-row gap-5 items-start">
                <div className="w-full max-w-[560px] flex flex-col gap-2">
                    <PuzzleBoard fen={position.fen} orientation={rep.color} interactive onMove={play} lastMove={position.last}
                                 arrows={children.map((m) => ({from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: m.mine ? 'green' as const : 'blue' as const}))}/>
                    <div className="flex flex-wrap gap-2 text-sm">
                        <button type="button" onClick={() => setLine((list) => list.slice(0, -1))} disabled={line.length === 0} className={BUTTON}>
                            <Undo2 size={14}/> {t('repertoire.back')}
                        </button>
                        <button type="button" onClick={() => setLine([])} disabled={line.length === 0} className={BUTTON}>
                            <RotateCcw size={14}/> {t('repertoire.start')}
                        </button>
                    </div>
                    <p className="font-mono text-xs" data-testid="repertoire-line">
                        {line.length === 0 ? <span className="text-boxwood/60">{t('repertoire.startPosition')}</span> : (
                            <>
                                <span className="text-boxwood/85">{knownText}</span>
                                {fresh.length > 0 && <span className="text-amber-300"> {fresh.join(' ')}</span>}
                            </>
                        )}
                    </p>
                    {fresh.length > 0 && (
                        <button type="button" onClick={() => void addNew()} disabled={busy} data-testid="repertoire-add-new"
                                className="self-start px-3 py-1.5 rounded bg-amber-700 text-white font-bold text-sm disabled:opacity-50">
                            {tp('repertoire.addNew', fresh.length)}
                        </button>
                    )}
                </div>

                <div className="flex-1 w-full min-w-0 flex flex-col gap-3">
                    <section className="bg-black/30 rounded-lg p-3 flex flex-col gap-2 text-sm" data-testid="repertoire-moves">
                        <h3 className="font-bold text-amber-200">{t('repertoire.movesHere')}</h3>
                        {!inTree && <p className="text-boxwood/70">{t('repertoire.outOfTree')}</p>}
                        {inTree && children.length === 0 && <p className="text-boxwood/70">{t('repertoire.noMoves')}</p>}
                        {children.map((m) => (
                            <button key={m.uci} type="button" onClick={() => play(m.uci)} data-testid={`repertoire-move-${m.uci}`}
                                    className="text-left flex flex-wrap items-baseline gap-x-2 hover:bg-black/20 rounded px-1">
                                <span className={`font-mono font-bold ${m.mine ? 'text-emerald-300' : 'text-sky-300'}`}>{m.san}</span>
                                <span className="text-xs text-boxwood/60">{t(m.mine ? 'repertoire.mineMove' : 'repertoire.theirMove')}</span>
                                {m.comment && <span className="w-full text-xs text-boxwood/85 break-words">{m.comment}</span>}
                            </button>
                        ))}
                    </section>

                    {current && (
                        <section className="bg-black/30 rounded-lg p-3 flex flex-col gap-2 text-sm" data-testid="repertoire-current">
                            <h3 className="font-bold text-amber-200">{t('repertoire.thisMove', {move: current.san})}</h3>
                            <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} rows={2}
                                      aria-label={t('repertoire.comment')} placeholder={t('repertoire.comment')} data-testid="repertoire-comment"
                                      className="bg-black/40 rounded p-2 text-xs"/>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => void saveComment()} disabled={busy || comment === current.comment}
                                        data-testid="repertoire-comment-save" className={BUTTON}>{t('repertoire.save')}</button>
                                <button type="button" onClick={() => void removeCurrent()} disabled={busy}
                                        data-testid="repertoire-remove-move" className={`${BUTTON} text-rose-300`}>
                                    <Trash2 size={14}/> {t('repertoire.removeMove')}
                                </button>
                            </div>
                        </section>
                    )}

                    <OpeningExplorer moves={line} onPlay={play}/>

                    <section className="bg-black/30 rounded-lg p-3 flex flex-col gap-2 text-sm">
                        <h3 className="font-bold text-amber-200">{t('repertoire.importPgn')}</h3>
                        <p className="text-xs text-boxwood/70">{t('repertoire.importHint')}</p>
                        <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={4} data-testid="repertoire-pgn"
                                  aria-label={t('repertoire.importPgn')} className="bg-black/40 rounded p-2 font-mono text-xs"/>
                        <button type="button" onClick={() => void importPgn()} disabled={busy || !pgn.trim()} data-testid="repertoire-import"
                                className="self-start px-3 py-1 rounded bg-amber-700 text-white font-bold disabled:opacity-50">
                            {t('repertoire.import')}
                        </button>
                    </section>
                </div>
            </div>
        </div>
    );
}
