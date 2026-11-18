// --- FILE: frontend/public/offline.js ---
// Офлайн-страница (таск 24.2): язык — как выбран на сайте (regence_language), иначе по языку браузера. Каталоги
// приложения лежат в сборке и без сети недоступны, поэтому три коротких текста — здесь, на тех же трёх языках.
// Отдельным файлом, а не в offline.html: CSP запрещает встроенные скрипты.

(function () {
    var TEXTS = {
        en: {
            title: 'No connection',
            text: 'regence needs the internet: games, puzzles and analysis live on the server. Check the connection and try again.',
            retry: 'Try again',
        },
        uk: {
            title: 'Немає зв’язку',
            text: 'regence працює з інтернетом: партії, задачі й розбір живуть на сервері. Перевірте з’єднання і спробуйте ще раз.',
            retry: 'Спробувати ще раз',
        },
        ru: {
            title: 'Нет связи',
            text: 'regence работает с интернетом: партии, задачи и разбор живут на сервере. Проверьте соединение и попробуйте ещё раз.',
            retry: 'Попробовать ещё раз',
        },
    };

    function language() {
        var saved = null;
        try {
            saved = localStorage.getItem('regence_language');
        } catch {
            saved = null;
        }
        if (saved && TEXTS[saved]) return saved;
        var browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
        return TEXTS[browser] ? browser : 'en';
    }

    var lang = language();
    var texts = TEXTS[lang];
    document.documentElement.lang = lang;
    document.getElementById('offline-title').textContent = texts.title;
    document.getElementById('offline-text').textContent = texts.text;
    var retry = document.getElementById('offline-retry');
    retry.textContent = texts.retry;
    retry.addEventListener('click', function () {
        window.location.reload();
    });
    // Связь вернулась — сразу на ту страницу, которую открывали.
    window.addEventListener('online', function () {
        window.location.reload();
    });
})();
