// --- FILE: frontend/src/test/setup.ts ---
// Общая настройка окружения для тестов компонентов (React Testing Library + jsdom).
// jsdom не реализует часть API, которые реально использует Chessboard.tsx — подставляем
// минимальные заглушки один раз здесь, а не в каждом тестовом файле.

import '@testing-library/jest-dom/vitest';
import {afterEach} from 'vitest';
import {cleanup, configure} from '@testing-library/react';

// Ожидания (findBy*, waitFor) по умолчанию сдаются через 1 с. Когда все файлы тестов идут параллельно
// под замером покрытия — а на раннере CI ядер меньше, — тяжёлые компоненты (GameViewer с графиком
// recharts) изредка не успевали отрисоваться, и тест падал при рабочем коде. Ожидание завершается сразу,
// как только условие выполнено, поэтому запас времени не замедляет зелёные тесты.
configure({asyncUtilTimeout: 5000});

afterEach(() => {
    cleanup();
});

if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {
    };
}

if (!document.elementsFromPoint) {
    document.elementsFromPoint = () => [];
}

if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
        value: {writeText: () => Promise.resolve()},
        configurable: true,
    });
}
