import { DialogCloseButton } from '@/components/DialogCloseButton';
import { detectInstallPlatform, type InstallPlatform } from '@/lib/pwaInstall';

interface PWAInstallDialogProps {
    open: boolean;
    /** true — приложение уже установлено, false — показываем инструкцию. */
    installed: boolean;
    onClose: () => void;
}

const PLATFORM_LABEL: Record<InstallPlatform, string> = {
    ios: 'iPhone / iPad (Safari)',
    android: 'Android',
    desktop: 'Компьютер (Chrome или Edge)',
    firefox: 'Firefox',
    other: 'Браузер',
};

const MANUAL_INSTRUCTIONS: Record<InstallPlatform, string> = {
    ios:
        'Откройте сайт в Safari, нажмите «Поделиться» (квадрат со стрелкой вверх), затем выберите «На экран «Домой»» и нажмите «Добавить».',
    android:
        'Откройте меню браузера (⋮) и выберите «Установить приложение» или «Добавить на главный экран».',
    desktop:
        'Нажмите значок установки в адресной строке справа или откройте меню браузера (⋮) → «Установить приложение» / «Установить ЗооКонтроль».',
    firefox:
        'В Firefox установка приложений не поддерживается. Откройте сайт в Chrome, Edge или Safari и установите приложение оттуда.',
    other:
        'Откройте меню браузера и выберите «Установить приложение» или «Добавить на экран «Домой»».',
};

/**
 * Всплывающее окно с краткой инструкцией по установке PWA.
 * Показывается, если приложение уже установлено или браузер не смог
 * предложить установку автоматически.
 */
export function PWAInstallDialog({ open, installed, onClose }: PWAInstallDialogProps) {
    if (!open) return null;

    const platform = detectInstallPlatform();

    return (
        <div className="dialog-overlay" onClick={onClose}>
            <div className="dialog" onClick={(event) => event.stopPropagation()}>
                <DialogCloseButton onClick={onClose} label="Закрыть инструкцию по установке" />
                <div className="dialog-title">
                    {installed ? 'Приложение уже установлено' : 'Как установить приложение'}
                </div>
                <div className="dialog-body">
                    {installed ? (
                        <p>
                            ЗооКонтроль уже запущен как установленное приложение. Открывайте его с домашнего
                            экрана, из меню «Пуск» или Launchpad.
                        </p>
                    ) : (
                        <>
                            <p>
                                Браузер не предложил установку автоматически. Установите приложение вручную —
                                это займёт несколько секунд.
                            </p>
                            <p>
                                <strong>{PLATFORM_LABEL[platform]}</strong>
                            </p>
                            <p>{MANUAL_INSTRUCTIONS[platform]}</p>
                            <p>После установки приложение появится на рабочем столе или домашнем экране.</p>
                        </>
                    )}
                </div>
                <div className="dialog-actions">
                    <button type="button" className="btn" onClick={onClose}>
                        Понятно
                    </button>
                </div>
            </div>
        </div>
    );
}
