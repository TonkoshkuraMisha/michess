// --- FILE: frontend/src/test/setup.ts ---
// Общая настройка окружения для тестов компонентов (React Testing Library + jsdom).
// jsdom не реализует часть API, которые реально использует Chessboard.tsx — подставляем
// минимальные заглушки один раз здесь, а не в каждом тестовом файле.

import '@testing-library/jest-dom/vitest';
import {afterEach} from 'vitest';
import {cleanup} from '@testing-library/react';

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
