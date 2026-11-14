import { useEffect, useState } from 'react';

/**
 * Баннер «Добавить на экран «Домой»» для iPhone / iPad.
 * В iOS Safari нет события beforeinstallprompt, поэтому показываем ручную
 * инструкцию: поделиться → «На экран «Домой»».
 * Показывается только на iOS, когда приложение не запущено в standalone-режиме
 * и пользователь ещё не скрывал баннер.
 */
export function PWAInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.platform) ||
      (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('zoo-pwa-dismissed') === '1';
    } catch {
      // localStorage недоступен
    }

    if (isIOS && !isStandalone && !dismissed) {
      setShow(true);
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem('zoo-pwa-dismissed', '1');
    } catch {
      // localStorage недоступен
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="pwa-install-banner">
      <div className="pwa-install-body">
        <span className="pwa-install-title">Установить приложение</span>
        <span className="pwa-install-text">
          Нажмите «Поделиться» → «На экран «Домой»»
        </span>
      </div>
      <div className="pwa-install-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={dismiss}>
          Понятно
        </button>
      </div>
    </div>
  );
}
