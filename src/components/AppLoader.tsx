interface AppLoaderProps {
    /** Подпись под индикатором (по умолчанию «Загрузка»). */
    label?: string;
}

/**
 * Экран загрузки приложения.
 * Показывается, пока Firebase/Auth не завершили инициализацию,
 * и использует цвета текущей темы (светлая/тёмная) из CSS-переменных.
 */
export function AppLoader({ label = 'Загрузка' }: AppLoaderProps) {
    return (
        <div className="app-loader" role="status" aria-live="polite" aria-label={label}>
            <div className="app-loader-content">
                <div className="app-loader-logo">
                    <span className="app-loader-ring" aria-hidden="true" />
                    <img
                        className="app-loader-icon"
                        src={`${import.meta.env.BASE_URL}icon.svg`}
                        alt=""
                        width={84}
                        height={84}
                        draggable={false}
                    />
                </div>
                <div className="app-loader-title">ЗооКонтроль</div>
                <div className="app-loader-bar" aria-hidden="true">
                    <span />
                </div>
                <div className="app-loader-status">
                    {label}
                    <span className="app-loader-dots" aria-hidden="true">
                        <i>.</i>
                        <i>.</i>
                        <i>.</i>
                    </span>
                </div>
            </div>
        </div>
    );
}
