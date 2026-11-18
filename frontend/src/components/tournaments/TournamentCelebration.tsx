// --- FILE: frontend/src/components/tournaments/TournamentCelebration.tsx ---
// Праздник призёра (решение владельца, 17.11): после окончания любого турнира, если игрок занял 1–3 место, —
// полноэкранная сцена: лучи, большой кубок цвета места (золото, серебро, бронза) с бликом, лавровый венок, конфетти
// и фанфары. Всё рисуется кодом (SVG, canvas, Web Audio) — без чужих картинок и записей. Показывается один раз на
// турнир (shouldCelebrate / markCelebrated); повторить можно кнопкой. При «уменьшить движение» — без конфетти и
// вращения.

import {useEffect, useRef} from 'react';
import {X} from 'lucide-react';
import {useI18n} from '../../i18n';
import {soundEngine} from '../../services/soundEngine';

const STORAGE_PREFIX = 'regence_celebrated_';
const CONFETTI_MS = 7000;

interface Medal {
    light: string;
    main: string;
    dark: string;
    glow: string;
    ray: string;
    key: 'first' | 'second' | 'third';
}

export const MEDALS: Record<1 | 2 | 3, Medal> = {
    1: {light: '#fff4b8', main: '#e2b33c', dark: '#8a6510', glow: 'rgba(255, 210, 90, 0.55)', ray: 'rgba(255, 215, 110, 0.16)', key: 'first'},
    2: {light: '#ffffff', main: '#c3c7cf', dark: '#6d717a', glow: 'rgba(220, 228, 240, 0.5)', ray: 'rgba(225, 232, 245, 0.14)', key: 'second'},
    3: {light: '#ffd9b0', main: '#c27a3e', dark: '#6b3a16', glow: 'rgba(230, 150, 90, 0.5)', ray: 'rgba(235, 160, 100, 0.15)', key: 'third'},
};

const CONFETTI_COLORS = ['#f6c945', '#e85d5d', '#4fa3e0', '#58c48b', '#b27ae6', '#ffffff', '#ff9f43'];

/** Праздник ещё не показывали для этого турнира (хранилище недоступно — показываем). */
export function shouldCelebrate(tournamentId: number): boolean {
    try {
        return localStorage.getItem(`${STORAGE_PREFIX}${tournamentId}`) === null;
    } catch {
        return true;
    }
}

export function markCelebrated(tournamentId: number): void {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}${tournamentId}`, '1');
    } catch {
        // Хранилище недоступно — праздник покажется ещё раз, это не беда.
    }
}

function reducedMotion(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

export interface CelebrationProps {
    place: number;
    /** Название турнира на языке игрока. */
    title: string;
    size: number;
    onClose: () => void;
}

export function TournamentCelebration({place, title, size, onClose}: CelebrationProps) {
    const {t} = useI18n();
    const rank = (Math.min(Math.max(place, 1), 3)) as 1 | 2 | 3;
    const medal = MEDALS[rank];
    const calm = reducedMotion();

    useEffect(() => {
        soundEngine.playFanfare(rank);
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [rank, onClose]);

    return (
        <div role="dialog" aria-modal="true" aria-label={t(`celebration.${medal.key}`)} data-testid="tournament-celebration"
             className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
             style={{                 background: `radial-gradient(circle at 50% 40%, ${medal.glow} 0%, transparent 42%), rgba(10, 7, 3, 0.985)`,                 backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',             }}>
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
            {/* Лучи */}
            <div aria-hidden="true" className="regence-anim absolute left-1/2 top-[42%] w-[160vmax] h-[160vmax] -translate-x-1/2 -translate-y-1/2"
                 style={{
                     background: `repeating-conic-gradient(${medal.ray} 0deg 6deg, transparent 6deg 18deg)`,
                     maskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
                     WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 60%)',
                     animation: calm ? undefined : 'regence-rays 40s linear infinite',
                 }}/>
            {!calm && <Confetti/>}
            <div className="relative z-[101] flex flex-col items-center gap-3 px-4 text-center">
                <h2 className="regence-anim text-4xl sm:text-6xl font-black uppercase"
                    style={{
                        color: medal.light, textShadow: `0 0 24px ${medal.glow}, 0 4px 0 ${medal.dark}`,
                        fontFamily: "Georgia, 'Times New Roman', serif", animation: calm ? undefined : 'regence-title 0.9s ease-out both',
                    }} data-testid="celebration-title">
                    {t(`celebration.${medal.key}`)}
                </h2>
                <div className="regence-anim" style={{animation: calm ? undefined : 'regence-pop 0.9s cubic-bezier(.2,1.4,.4,1) 0.15s both'}}>
                    <Trophy place={rank}/>
                </div>
                <p className="text-lg sm:text-2xl font-bold text-amber-100" data-testid="celebration-subtitle">{title}</p>
                <p className="text-base sm:text-lg text-amber-200/90">{t('celebration.place', {place: rank, size})}</p>
                <button type="button" onClick={onClose} autoFocus data-testid="celebration-close"
                        className="mt-2 px-6 py-2.5 rounded-full font-bold text-lg shadow-lg cursor-pointer"
                        style={{background: `linear-gradient(180deg, ${medal.light}, ${medal.main})`, color: medal.dark}}>
                    {t('celebration.continue')}
                </button>
            </div>
            <button type="button" onClick={onClose} aria-label={t('celebration.continue')}
                    className="absolute top-3 right-3 z-[103] p-2 rounded-full bg-black/40 text-white hover:bg-black/60">
                <X size={20}/>
            </button>
        </div>
    );
}
