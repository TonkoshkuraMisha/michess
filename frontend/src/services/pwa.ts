// Приложение на телефоне (таск 24.2): регистрация сервис-воркера (public/sw.js) и установка на главный экран.
//
// Сервис-воркер — только в сборке: в разработке он кэшировал бы файлы Vite и мешал горячей перезагрузке.
// Установка: Chrome и Edge присылают beforeinstallprompt — событие запоминается, и кнопка в настройках показывает
// системный диалог; их собственное предложение установки при этом не отключается. Safari на iPhone события не
// присылает — там подсказка «Поделиться → На экран „Домой“».

import {useSyncExternalStore} from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'installed' | 'available' | 'ios' | 'unsupported';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((listener) => listener());
}

export function isStandalone(win: Window = window): boolean {
    const nav = win.navigator as Navigator & { standalone?: boolean };
    return Boolean(win.matchMedia?.('(display-mode: standalone)').matches || nav.standalone);
}

export function isIos(win: Window = window): boolean {
    const nav = win.navigator;
    // iPad с iPadOS 13+ представляется Mac'ом, но с сенсорным экраном.
    return /iphone|ipad|ipod/i.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

export function installState(win: Window = window): InstallState {
    if (installedNow || isStandalone(win)) return 'installed';
    if (deferredPrompt) return 'available';
    if (isIos(win)) return 'ios';
    return 'unsupported';
}

/** Системный диалог установки; true — игрок согласился. */
export async function promptInstall(): Promise<boolean> {
    const event = deferredPrompt;
    if (!event) return false;
    deferredPrompt = null;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') installedNow = true;
    notify();
    return choice.outcome === 'accepted';
}

/** Вызывается один раз при старте приложения (main.tsx). */
export function initPwa(win: Window = window, production: boolean = import.meta.env.PROD): void {
    win.addEventListener('beforeinstallprompt', (event) => {
        deferredPrompt = event as BeforeInstallPromptEvent;
        notify();
    });
    win.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        installedNow = true;
        notify();
    });
    const serviceWorker = win.navigator.serviceWorker;
    if (production && serviceWorker) {
        const register = () => {
            serviceWorker.register('/sw.js').catch(() => undefined);
        };
        if (win.document.readyState === 'complete') register();
        else win.addEventListener('load', register, {once: true});
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useInstallState(): InstallState {
    return useSyncExternalStore(subscribe, () => installState());
}

/** Для тестов: забыть сохранённое событие и установку. */
export function resetPwaForTests(): void {
    deferredPrompt = null;
    installedNow = false;
    notify();
}
