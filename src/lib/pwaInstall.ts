/**
 * Утилиты для установки PWA.
 *
 * Событие `beforeinstallprompt` браузер может отправить до того, как React
 * смонтирует компоненты, поэтому захват события выполняется один раз при
 * старте приложения (см. `initPWAInstallCapture` в `main.tsx`), а компоненты
 * подписываются на уже сохранённое событие.
 */

export interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
    prompt: () => Promise<void>;
}

export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'firefox' | 'other';

type InstallPromptListener = (event: BeforeInstallPromptEvent | null) => void;

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let appInstalled = false;
const listeners = new Set<InstallPromptListener>();

function notifyListeners(): void {
    listeners.forEach((listener) => listener(deferredPrompt));
}

/** Начинает перехват события `beforeinstallprompt`. Вызывать один раз при старте. */
export function initPWAInstallCapture(): void {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;

    window.addEventListener('beforeinstallprompt', (event) => {
        // Не даём браузеру показать свой мини-баннер — установку запускаем из меню.
        event.preventDefault();
        deferredPrompt = event as BeforeInstallPromptEvent;
        notifyListeners();
    });

    window.addEventListener('appinstalled', () => {
        appInstalled = true;
        deferredPrompt = null;
        notifyListeners();
    });
}

/** Приложение запущено как установленное (standalone) или уже установлено. */
export function isAppInstalled(): boolean {
    return appInstalled || isStandalone();
}

/** Приложение открыто в standalone-режиме (установленная PWA). */
export function isStandalone(): boolean {
    if (typeof window === 'undefined') return false;

    try {
        if (window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch {
        // matchMedia может быть недоступен — проверяем iOS-флаг ниже
    }

    return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Сохранённое событие установки (или null, если браузер его ещё не прислал). */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
    return deferredPrompt;
}

/** Сбрасывает сохранённое событие — повторно вызвать prompt() нельзя. */
export function clearInstallPrompt(): void {
    deferredPrompt = null;
    notifyListeners();
}

/** Подписка на появление/исчезновение события установки. */
export function subscribePWAInstall(listener: InstallPromptListener): () => void {
    listeners.add(listener);
    listener(deferredPrompt);
    return () => {
        listeners.delete(listener);
    };
}

/** Определяет платформу, чтобы показать подходящую инструкцию по установке. */
export function detectInstallPlatform(): InstallPlatform {
    if (typeof navigator === 'undefined') return 'other';

    const ua = navigator.userAgent;
    const isIOS =
        /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOS) return 'ios';
    if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';

    return 'other';
}
