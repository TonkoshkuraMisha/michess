// --- FILE: frontend/src/components/tournaments/TournamentCelebration.tsx ---
// Экран окончания турнира (решение владельца, 17.11; итоговая таблица — 21.11): после окончания любого турнира или
// арены — полноэкранное окно. Призёру (1–3 место): лучи, большой кубок цвета места (золото, серебро, бронза) с бликом,
// лавровый венок, конфетти и фанфары. Остальным — спокойный значок места без фанфар. Рядом с кубком — сводка игрока
// (очки, победы/ничьи/поражения, рейтинг) и прокручиваемая таблица всех участников с аватарами, рейтингами и очками;
// строка игрока подсвечена и прокручена в видимую область (строки готовит services/tournamentResults.ts). Над таблицей —
// сводка турнира (партий, ничьих, побед белых — как шапка итогов lichess), под именем — победы/ничьи/поражения (турнир)
// или перформанс (арена), снизу — «Скачать CSV» (как результаты на chess.com). Всё рисуется кодом (SVG, canvas, Web Audio) — без чужих картинок и записей. Показывается один раз на
// турнир (shouldCelebrate / markCelebrated; ключ — номер турнира или строка вида «arena-5» для арен, 33.5); повторить
// можно кнопкой. При «уменьшить движение» — без конфетти и вращения.
// Единственное хранилище — localStorage с ключом regence_celebrated_<id>. Фанфары — services/soundEngine.ts.
// Используют TournamentsPage.tsx, TournamentGameBar.tsx и arena/ArenaPages.tsx.

import {useEffect, useRef} from 'react';
import {Download, X} from 'lucide-react';
import {useI18n} from '../../i18n';
import {soundEngine} from '../../services/soundEngine';
import {type ResultRow, type ResultStats, resultsCsv, type TournamentSummary} from '../../services/tournamentResults';
import {PlayerAvatar} from '../PlayerAvatar';

// Префикс ключа localStorage: отметка «праздник для этого турнира уже показан».
const STORAGE_PREFIX = 'regence_celebrated_';
// Длительность конфетти (мс): залпы из углов, затем дождь сверху до CONFETTI_MS минус 2,5 с; ещё 4 с на падение остатка.
const CONFETTI_MS = 7000;

/** Палитра медали места: оттенки металла, свечение фона, цвет лучей и ключ заголовка в каталоге celebration.*. */
interface Medal {
    light: string;
    main: string;
    dark: string;
    glow: string;
    ray: string;
    key: 'first' | 'second' | 'third';
}

/** Палитры по местам 1–3. */
export const MEDALS: Record<1 | 2 | 3, Medal> = {
    1: {light: '#fff4b8', main: '#e2b33c', dark: '#8a6510', glow: 'rgba(255, 210, 90, 0.55)', ray: 'rgba(255, 215, 110, 0.16)', key: 'first'},
    2: {light: '#ffffff', main: '#c3c7cf', dark: '#6d717a', glow: 'rgba(220, 228, 240, 0.5)', ray: 'rgba(225, 232, 245, 0.14)', key: 'second'},
    3: {light: '#ffd9b0', main: '#c27a3e', dark: '#6b3a16', glow: 'rgba(230, 150, 90, 0.5)', ray: 'rgba(235, 160, 100, 0.15)', key: 'third'},
};

// Цвета кусочков конфетти.
const CONFETTI_COLORS = ['#f6c945', '#e85d5d', '#4fa3e0', '#58c48b', '#b27ae6', '#ffffff', '#ff9f43'];

/** Праздник ещё не показывали для этого турнира (хранилище недоступно — показываем). */
export function shouldCelebrate(tournamentId: number | string): boolean {
    try {
        return localStorage.getItem(`${STORAGE_PREFIX}${tournamentId}`) === null;
    } catch {
        return true;
    }
}

/** Запоминает, что праздник для турнира показан. */
export function markCelebrated(tournamentId: number | string): void {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}${tournamentId}`, '1');
    } catch {
        // Хранилище недоступно — праздник покажется ещё раз, это не беда.
    }
}

/** Включено ли в системе «уменьшить движение» (тогда без конфетти и анимаций). */
function reducedMotion(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Один кусочек конфетти: положение, скорость, размер, вращение, раскачивание (sway) и форма (круг или полоска).
interface Piece {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    angle: number;
    spin: number;
    color: string;
    round: boolean;
    sway: number;
}

/** Конфетти на canvas: два залпа из нижних углов, затем дождь сверху; сила тяжести, сопротивление, вращение. */
function Confetti() {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const el = canvas.current;
        const ctx = el?.getContext?.('2d');
        if (!el || !ctx || reducedMotion()) return;
        let width = (el.width = window.innerWidth);
        let height = (el.height = window.innerHeight);
        const pieces: Piece[] = [];
        const add = (x: number, y: number, vx: number, vy: number) => pieces.push({
            x, y, vx, vy, size: 6 + Math.random() * 7, angle: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.3,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)], round: Math.random() < 0.25,
            sway: Math.random() * Math.PI * 2,
        });
        const burst = (fromLeft: boolean) => {
            for (let i = 0; i < 90; i++) {
                const speed = 9 + Math.random() * 9;
                const angle = (fromLeft ? -Math.PI / 3 : -2 * Math.PI / 3) + (Math.random() - 0.5) * 0.7;
                add(fromLeft ? 0 : width, height, Math.cos(angle) * speed, Math.sin(angle) * speed * 1.25);
            }
        };
        burst(true);
        burst(false);
        const started = performance.now();
        let rainUntil = started + CONFETTI_MS - 2500;
        let frame = 0;
        const onResize = () => {
            width = el.width = window.innerWidth;
            height = el.height = window.innerHeight;
        };
        window.addEventListener('resize', onResize);
        const tick = (now: number) => {
            if (now < rainUntil && Math.random() < 0.6) add(Math.random() * width, -10, (Math.random() - 0.5) * 2, 2 + Math.random() * 2);
            ctx.clearRect(0, 0, width, height);
            for (const p of pieces) {
                p.vy += 0.18;
                p.vx *= 0.985;
                p.vy *= 0.985;
                p.sway += 0.08;
                p.x += p.vx + Math.sin(p.sway) * 0.8;
                p.y += p.vy;
                p.angle += p.spin;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.fillStyle = p.color;
                if (p.round) {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.cos(p.sway))));
                }
                ctx.restore();
            }
            for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].y > height + 40) pieces.splice(i, 1);
            if (now - started < CONFETTI_MS + 4000 && (pieces.length > 0 || now < rainUntil)) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => {
            rainUntil = 0;
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', onResize);
        };
    }, []);
    return <canvas ref={canvas} className="pointer-events-none fixed inset-0 z-[102]" aria-hidden="true" data-testid="celebration-confetti"/>;
}

// Геометрия лаврового венка в координатах SVG кубка: центр, радиус дуги, углы начала и конца ветви (градусы), число пар листьев.
const WREATH = {cx: 160, cy: 165, r: 132, from: 100, to: 235, leaves: 12};

/**
 * Левая лавровая ветвь: листья парами по дуге окружности вокруг кубка — от низа (у подставки) вверх к краю чаши;
 * пара листьев направлена по касательной. Каждая пара «вырастает» с задержкой. Правая ветвь — зеркало левой.
 */
function LaurelBranch() {
    const {cx, cy, r, from, to, leaves} = WREATH;
    const point = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
    const [x0, y0] = point(from);
    const [x1, y1] = point(to);
    const pairs = Array.from({length: leaves}, (_, i) => {
        const deg = from + ((to - from) * i) / (leaves - 1);
        const [x, y] = point(deg);
        return {x, y, tangent: deg + 90, scale: 1 - i * 0.03, delay: 0.5 + i * 0.07};
    });
    return (
        <g>
            <path d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`} fill="none" stroke="#4d7a2c" strokeWidth="3" strokeLinecap="round"/>
            {pairs.map((leaf, i) => (
                <g key={i} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.tangent}) scale(${leaf.scale})`}>
                    <g className="regence-leaf" style={{animationDelay: `${leaf.delay}s`}}>
                        <ellipse cx={-4} cy={-9} rx={15} ry={6} fill="url(#laurel)" transform="rotate(-28)"/>
                        <ellipse cx={-4} cy={9} rx={15} ry={6} fill="url(#laurel)" transform="rotate(28)"/>
                    </g>
                </g>
            ))}
        </g>
    );
}
/** Кубок цвета места (SVG) с лавровым венком и бликом; левая ветвь венка зеркалится в правую. */
function Trophy({place}: { place: 1 | 2 | 3 }) {
    const m = MEDALS[place];
    return (
        <svg viewBox="0 0 320 340" className="w-[min(78vw,360px)] h-auto drop-shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
             role="img" aria-hidden="true" data-testid={`celebration-trophy-${place}`}>
            <defs>
                <linearGradient id="cup" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor={m.dark}/>
                    <stop offset="0.35" stopColor={m.light}/>
                    <stop offset="0.6" stopColor={m.main}/>
                    <stop offset="1" stopColor={m.dark}/>
                </linearGradient>
                <linearGradient id="shine" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor="#fff" stopOpacity="0"/>
                    <stop offset="0.5" stopColor="#fff" stopOpacity="0.75"/>
                    <stop offset="1" stopColor="#fff" stopOpacity="0"/>
                </linearGradient>
                <linearGradient id="laurel" x1="0" x2="1">
                    <stop offset="0" stopColor="#3f7a2a"/>
                    <stop offset="1" stopColor={place === 1 ? '#d9b54a' : '#7fb34f'}/>
                </linearGradient>
                <clipPath id="cupClip">
                    <path d="M95 60 H225 V120 C225 175 195 205 160 212 C125 205 95 175 95 120 Z"/>
                </clipPath>
            </defs>
            <LaurelBranch/>
            <g transform="translate(320 0) scale(-1 1)"><LaurelBranch/></g>
            {/* Ручки */}
            <path d="M95 78 C55 78 55 140 102 150" fill="none" stroke="url(#cup)" strokeWidth="12" strokeLinecap="round"/>
            <path d="M225 78 C265 78 265 140 218 150" fill="none" stroke="url(#cup)" strokeWidth="12" strokeLinecap="round"/>
            {/* Чаша */}
            <path d="M95 60 H225 V120 C225 175 195 205 160 212 C125 205 95 175 95 120 Z" fill="url(#cup)"/>
            <rect x="88" y="52" width="144" height="14" rx="5" fill={m.main} stroke={m.dark} strokeWidth="2"/>
            <g clipPath="url(#cupClip)">
                <rect className="regence-shine" x="-60" y="40" width="50" height="190" fill="url(#shine)" transform="skewX(-18)"/>
            </g>
            {/* Звезда и место */}
            <circle cx="160" cy="128" r="30" fill={m.dark} opacity="0.35"/>
            <text x="160" y="142" textAnchor="middle" fontSize="40" fontWeight="800" fill={m.light}
                  fontFamily="Georgia, 'Times New Roman', serif">{place}</text>
            {/* Ножка и подставка */}
            <rect x="150" y="210" width="20" height="38" fill="url(#cup)"/>
            <rect x="118" y="246" width="84" height="16" rx="4" fill="url(#cup)"/>
            <rect x="104" y="262" width="112" height="26" rx="5" fill={m.dark}/>
            <rect x="112" y="268" width="96" height="14" rx="3" fill={m.main} opacity="0.85"/>
        </svg>
    );
}

// Палитра для места вне тройки призёров: сдержанный синевато-серый, без фанфар и конфетти.
const PLAIN: Medal = {
    light: '#e6edf7', main: '#8fa3c0', dark: '#3d4a60', glow: 'rgba(143, 163, 192, 0.35)', ray: 'rgba(160, 180, 210, 0.08)',
    key: 'third',
};

export interface CelebrationProps {
    place: number;
    /** Название турнира на языке игрока. */
    title: string;
    size: number;
    onClose: () => void;
    /** Итоговая таблица всех участников; без неё окно показывает только кубок (как раньше). */
    rows?: ResultRow[];
    /** Сводка игрока над таблицей. */
    stats?: ResultStats | null;
    /** Сводка турнира целиком; у арены её нет. */
    summary?: TournamentSummary | null;
    /** Подпись детали под именем — «перф.» у арены; у турнира там победы/ничьи/поражения. */
    detailLabel?: string;
}

/** Скачивает таблицу итогов файлом CSV (без сервера: файл собирается в браузере). */
function downloadCsv(rows: ResultRow[], title: string): void {
    try {
        const url = URL.createObjectURL(new Blob(['\ufeff' + resultsCsv(rows)], {type: 'text/csv;charset=utf-8'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${title.replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    } catch {
        // Браузер без Blob/URL — кнопка просто ничего не делает.
    }
}

/** Значок места вне тройки: круг с номером вместо кубка. */
function PlaceBadge({place}: { place: number }) {
    return (
        <div className="flex items-center justify-center w-28 h-28 rounded-full border-4 text-5xl font-black"
             style={{borderColor: PLAIN.main, color: PLAIN.light, background: `radial-gradient(circle, ${PLAIN.dark}, transparent 85%)`,
                 fontFamily: "Georgia, 'Times New Roman', serif"}} data-testid="celebration-badge">
            {place}
        </div>
    );
}

/** Таблица участников: место, аватар, имя, рейтинг, очки; прокручивается, строка игрока подсвечена и видна сразу. */
function ResultsTable({rows, summary, title, detailLabel}: {
    rows: ResultRow[]; summary?: TournamentSummary | null; title: string; detailLabel?: string;
}) {
    const {t} = useI18n();
    const mineRef = useRef<HTMLLIElement>(null);
    useEffect(() => {
        mineRef.current?.scrollIntoView?.({block: 'center'});
    }, [rows]);
    return (
        <section className="w-full rounded-xl bg-black/40 border border-amber-200/20 flex flex-col min-h-0" data-testid="celebration-table">
            <h3 className="px-4 py-2 text-sm font-bold uppercase tracking-wide text-amber-200/90 border-b border-amber-200/15">
                {t('celebration.standings')}
            </h3>
            {summary && (
                <p className="px-4 py-1.5 text-xs text-amber-200/80 border-b border-amber-200/10" data-testid="celebration-summary">
                    {t('celebration.summary', {games: summary.games, draws: summary.drawPercent, white: summary.whitePercent})}
                </p>
            )}
            <ol className="overflow-y-auto max-h-[38vh] lg:max-h-[56vh] divide-y divide-amber-200/10">
                {rows.map((r) => (
                    <li key={r.key} ref={r.mine ? mineRef : undefined} data-testid={`celebration-row-${r.key}`} aria-current={r.mine ? 'true' : undefined}
                        className={`flex items-center gap-3 px-4 py-2 text-left ${r.mine ? 'bg-amber-300/20 font-bold' : ''}`}>
                        <span className="w-7 text-right font-mono text-amber-200/80">{r.place}</span>
                        <PlayerAvatar username={r.name} avatar={r.avatar} className="w-8 h-8 rounded-full"/>
                        <span className="flex-1 min-w-0">
                            <span className="block truncate text-amber-50">{r.name}</span>
                            {r.detail && (
                                <span className="block text-[11px] font-normal text-amber-200/60" data-testid={`celebration-detail-${r.key}`}>
                                    {detailLabel ? `${detailLabel} ${r.detail}` : r.detail}
                                </span>
                            )}
                        </span>
                        {r.rating !== null && <span className="text-xs text-amber-200/70 font-mono">{r.rating}</span>}
                        <span className="w-12 text-right font-mono text-amber-100">{r.score}</span>
                    </li>
                ))}
            </ol>
            <button type="button" onClick={() => downloadCsv(rows, title)} data-testid="celebration-csv"
                    className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm text-amber-200 border-t border-amber-200/15 hover:bg-amber-200/10 cursor-pointer">
                <Download size={14}/> {t('celebration.downloadCsv')}
            </button>
        </section>
    );
}

/** Сводка игрока: очки, победы/ничьи/поражения, рейтинг — плитками под местом. */
function StatsStrip({stats}: { stats: ResultStats }) {
    const {t} = useI18n();
    const cells = [
        {key: 'points', label: t('celebration.stats.points'), value: stats.points},
        {key: 'record', label: t('celebration.stats.record'), value: `${stats.wins}/${stats.draws}/${stats.losses}`},
        ...(stats.rating !== null ? [{key: 'rating', label: t('celebration.stats.rating'), value: String(stats.rating)}] : []),
    ];
    return (
        <dl className="flex flex-wrap justify-center gap-2" data-testid="celebration-stats">
            {cells.map((c) => (
                <div key={c.key} className="min-w-20 rounded-lg bg-black/35 border border-amber-200/20 px-3 py-1.5">
                    <dt className="text-[11px] uppercase tracking-wide text-amber-200/70">{c.label}</dt>
                    <dd className="text-lg font-bold text-amber-50" data-testid={`celebration-stat-${c.key}`}>{c.value}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * Полноэкранный экран итогов: у призёра играют фанфары и сыплется конфетти; закрывается кнопкой или Escape.
 * Место 1–3 — кубок цвета места; ниже — значок с номером. С rows рядом с кубком появляется таблица участников.
 */
export function TournamentCelebration({place, title, size, onClose, rows, stats, summary, detailLabel}: CelebrationProps) {
    const {t} = useI18n();
    const podium = place >= 1 && place <= 3;
    const rank = (Math.min(Math.max(place, 1), 3)) as 1 | 2 | 3;
    const medal = podium ? MEDALS[rank] : PLAIN;
    const heading = podium ? t(`celebration.${medal.key}`) : t('celebration.finished');
    const calm = reducedMotion() || !podium;
    const withTable = rows !== undefined && rows.length > 0;

    useEffect(() => {
        if (podium) soundEngine.playFanfare(rank);
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [podium, rank, onClose]);

    return (
        <div role="dialog" aria-modal="true" aria-label={heading} data-testid="tournament-celebration"
             className="fixed inset-0 z-[100] overflow-y-auto overflow-x-hidden"
             style={{background: `radial-gradient(circle at 50% 40%, ${medal.glow} 0%, transparent 42%), rgba(10, 7, 3, 0.985)`,
                 backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)'}}>
            <style>{`
                @keyframes regence-rays { to { transform: rotate(360deg); } }
                @keyframes regence-pop { 0% { transform: scale(0.2) translateY(60px); opacity: 0; }
                    60% { transform: scale(1.08) translateY(-6px); opacity: 1; } 100% { transform: scale(1) translateY(0); } }
                @keyframes regence-shine { 0%, 35% { transform: translateX(0) skewX(-18deg); }
                    70%, 100% { transform: translateX(420px) skewX(-18deg); } }
                @keyframes regence-leaf { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                @keyframes regence-title { 0% { transform: translateY(24px); opacity: 0; letter-spacing: 0.5em; }
                    100% { transform: translateY(0); opacity: 1; letter-spacing: 0.06em; } }
                .regence-leaf { transform-box: fill-box; transform-origin: center; animation: regence-leaf 0.45s ease-out both; }
                .regence-shine { animation: regence-shine 3.2s ease-in-out 1s infinite; }
                @media (prefers-reduced-motion: reduce) {
                    .regence-leaf, .regence-shine, .regence-anim { animation: none !important; }
                }
            `}</style>
            {/* Лучи (фон, не прокручивается) */}
            <div aria-hidden="true" className="regence-anim fixed left-1/2 top-[42%] w-[160vmax] h-[160vmax] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                 style={{
                     background: `repeating-conic-gradient(${medal.ray} 0deg 6deg, transparent 6deg 18deg)`,
                     maskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
                     WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
                     animation: calm ? undefined : 'regence-rays 40s linear infinite',
                 }}/>
            {!calm && <Confetti/>}
            <div className={`relative z-[101] min-h-full flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-12 px-4 py-10 text-center ${withTable ? 'max-w-5xl mx-auto' : ''}`}>
                <div className="flex flex-col items-center gap-3">
                    <h2 className="regence-anim text-4xl sm:text-6xl font-black uppercase"
                        style={{
                            color: medal.light, textShadow: `0 0 24px ${medal.glow}, 0 4px 0 ${medal.dark}`,
                            fontFamily: "Georgia, 'Times New Roman', serif", animation: calm ? undefined : 'regence-title 0.9s ease-out both',
                        }} data-testid="celebration-title">
                        {heading}
                    </h2>
                    <div className="regence-anim" style={{animation: calm ? undefined : 'regence-pop 0.9s cubic-bezier(.2,1.4,.4,1) 0.15s both'}}>
                        {podium ? <Trophy place={rank}/> : <PlaceBadge place={place}/>}
                    </div>
                    <p className="text-lg sm:text-2xl font-bold text-amber-100" data-testid="celebration-subtitle">{title}</p>
                    <p className="text-base sm:text-lg text-amber-200/90">{t('celebration.place', {place, size})}</p>
                    {stats && <StatsStrip stats={stats}/>}
                    <button type="button" onClick={onClose} autoFocus data-testid="celebration-close"
                            className="mt-2 px-6 py-2.5 rounded-full font-bold text-lg shadow-lg cursor-pointer"
                            style={{background: `linear-gradient(180deg, ${medal.light}, ${medal.main})`, color: medal.dark}}>
                        {t('celebration.continue')}
                    </button>
                </div>
                {withTable && <div className="w-full lg:w-[26rem] lg:shrink-0"><ResultsTable rows={rows} summary={summary} title={title} detailLabel={detailLabel}/></div>}
            </div>
            <button type="button" onClick={onClose} aria-label={t('celebration.continue')}
                    className="fixed top-3 right-3 z-[103] p-2 rounded-full bg-black/40 text-white hover:bg-black/60">
                <X size={20}/>
            </button>
        </div>
    );
}
