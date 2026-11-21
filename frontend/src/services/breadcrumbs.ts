// --- FILE: frontend/src/services/breadcrumbs.ts ---
// «Хлебные крошки» — след последних событий страницы: запросы к API (с номером X-Request-ID, по нему в журнале сервера
// находится вся цепочка), сообщения и закрытия WebSocket, смены страниц. Лежит в sessionStorage, поэтому ПЕРЕЖИВАЕТ
// перезагрузку страницы: отчёт новой страницы (clientErrors.ts) несёт то, что происходило до перезагрузки. Модуль без
// зависимостей от сети — его пишут http.ts и gameSocket.ts, читает clientErrors.ts (так нет круговой зависимости).
// В крошки не попадают тела запросов, токены и личные данные — только метод, путь без параметров, статус и номер запроса.

export type CrumbKind = 'request' | 'socket' | 'route' | 'reload';

export interface Breadcrumb {
    t: number;
    kind: CrumbKind;
    name: string;
    status?: number;
    request_id?: string;
}

/** Путь запроса отчёта: его собственные запросы в крошки не пишутся (иначе отчёт описывал бы сам себя). */
export const CLIENT_ERRORS_PATH = '/client-errors';

const STORAGE_KEY = 'regence_breadcrumbs';
// Столько крошек принимает сервер (MAX_BREADCRUMBS в src/api/client_errors.py) и хранит страница.
const MAX_CRUMBS = 30;
const MAX_NAME = 120;

let crumbs: Breadcrumb[] = loadCrumbs();

function loadCrumbs(): Breadcrumb[] {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as Breadcrumb[]).slice(-MAX_CRUMBS) : [];
    } catch {
        return [];
    }
}

function saveCrumbs() {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(crumbs));
    } catch {
        // Хранилище недоступно (приватный режим, переполнено) — крошки остаются только в памяти.
    }
}

/** Дописывает событие в след; старые вытесняются. */
export function addBreadcrumb(kind: CrumbKind, name: string, extra: {status?: number; request_id?: string} = {}) {
    crumbs = [...crumbs, {t: Date.now(), kind, name: name.slice(0, MAX_NAME), ...extra}].slice(-MAX_CRUMBS);
    saveCrumbs();
}

/** Копия следа (для отчётов и тестов). */
export function getBreadcrumbs(): Breadcrumb[] {
    return [...crumbs];
}

/** Очистка следа — только для тестов. */
export function clearBreadcrumbs() {
    crumbs = [];
    saveCrumbs();
}

/** Новый номер запроса: 16 символов [0-9a-f] — подходит под REQUEST_ID_PATTERN сервера. */
export function newRequestId(): string {
    const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    return uuid.replace(/-/g, '').slice(0, 16);
}
