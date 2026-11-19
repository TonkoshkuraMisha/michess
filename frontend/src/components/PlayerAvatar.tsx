// --- FILE: frontend/src/components/PlayerAvatar.tsx ---
// Аватар игрока из собственного набора (таск 18.4): фигура «Льюис» (CC0) на цветном фоне. Игрок выбирает аватар в
// настройках; пока не выбрал — аватар вычисляется из имени. Внешний сервис аватаров больше не нужен: имя игрока не
// уходит на чужой сервер. Код аватара — «<фигура>-<номер фона>» (например wN-3), хранится в профиле на сервере
// (поле avatar, сохраняется через services/profileSettings.ts); картинки фигур — public/assets/pieces/lewis/.
// Используется в таблице лидеров, профиле, настройках (AvatarPicker) и шапке.

/** Фигуры, доступные как аватар: код цвета и вида фигуры (имя файла SVG без расширения). */
export const AVATAR_PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'] as const;
/** Цвета фона аватара; в коде аватара хранится индекс в этом списке. */
export const AVATAR_BACKGROUNDS = ['#D0A972', '#7FA37A', '#7A9CC6', '#C98A7A', '#A58BC4', '#D6C26E', '#6FB0AA', '#B9B2A6'] as const;
// Формат кода аватара: фигура и индекс фона (0–7 — по числу AVATAR_BACKGROUNDS).
const AVATAR_RE = /^([wb][KQRBNP])-([0-7])$/;

/** FNV-1a по символам имени: стабильное число, из которого выбираются фигура и фон по умолчанию. */
function hash(text: string): number {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
    return h >>> 0;
}

/** Код аватара: выбранный, если он корректен, иначе — по имени игрока. */
export function avatarCode(username: string, chosen?: string | null): string {
    if (chosen && AVATAR_RE.test(chosen)) return chosen;
    const h = hash(username.toLowerCase());
    return `${AVATAR_PIECES[h % AVATAR_PIECES.length]}-${(h >>> 8) % AVATAR_BACKGROUNDS.length}`;
}

/** Аватар игрока: выбранный или вычисленный из имени; alt пустой, если рядом уже есть имя. */
export function PlayerAvatar({username, avatar, className = 'w-8 h-8', alt = ''}: {
    username: string; avatar?: string | null; className?: string; alt?: string;
}) {
    const [, piece, background] = AVATAR_RE.exec(avatarCode(username, avatar))!;
    return (
        <span className={`inline-flex items-center justify-center overflow-hidden shrink-0 ${className}`}
              style={{backgroundColor: AVATAR_BACKGROUNDS[Number(background)]}} data-testid="player-avatar" data-avatar={`${piece}-${background}`}>
            <img src={`/assets/pieces/lewis/${piece}.svg`} alt={alt} className="w-[86%] h-[86%] object-contain" draggable={false}/>
        </span>
    );
}

/** Выбор аватара в настройках: фигура и цвет фона. */
export function AvatarPicker({username, value, onChange}: { username: string; value: string | null; onChange: (code: string) => void }) {
    const current = avatarCode(username, value);
    const [, piece, background] = AVATAR_RE.exec(current)!;
    return (
        <div className="flex flex-col gap-2" data-testid="avatar-picker">
            <div className="grid grid-cols-6 gap-1.5 max-w-sm">
                {AVATAR_PIECES.map((code) => (
                    <button key={code} type="button" aria-pressed={code === piece} data-testid={`avatar-piece-${code}`}
                            onClick={() => onChange(`${code}-${background}`)}
                            className={`rounded-md p-0.5 border-2 cursor-pointer ${code === piece ? 'border-amber-400' : 'border-transparent'}`}>
                        <PlayerAvatar username={username} avatar={`${code}-${background}`} className="w-10 h-10 rounded"/>
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {AVATAR_BACKGROUNDS.map((color, index) => (
                    <button key={color} type="button" aria-pressed={String(index) === background} data-testid={`avatar-bg-${index}`}
                            aria-label={color} onClick={() => onChange(`${piece}-${index}`)}
                            className={`w-7 h-7 rounded-full border-2 cursor-pointer ${String(index) === background ? 'border-amber-300' : 'border-black/40'}`}
                            style={{backgroundColor: color}}/>
                ))}
            </div>
        </div>
    );
}
