// --- FILE: frontend/src/test/storage.ts ---
// Node 25+ объявляет собственные глобальные localStorage/sessionStorage (Web Storage API). Без ключа
// --localstorage-file они не работают, а окружение jsdom в vitest не перезаписывает уже существующие глобальные
// имена — и все тесты, которые трогают localStorage, падали («Cannot read properties of undefined»), хотя на Node 24
// (как в CI) проходили. Подключается первым файлом настройки, раньше модулей, которые читают хранилище при импорте.

const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
    for (const name of ['localStorage', 'sessionStorage'] as const) {
        if (globalThis[name] !== dom.window[name]) {
            Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true, writable: true});
        }
    }
}
