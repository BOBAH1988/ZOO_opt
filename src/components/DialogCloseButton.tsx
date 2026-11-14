interface DialogCloseButtonProps {
    onClick: () => void;
    /** Подпись для screen reader и подсказки. */
    label?: string;
}

/**
 * Красный крестик в правом верхнем углу модального окна.
 * Используется во всех диалогах приложения для единообразного закрытия.
 */
export function DialogCloseButton({ onClick, label = 'Закрыть окно' }: DialogCloseButtonProps) {
    return (
        <button
            type="button"
            className="dialog-close"
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
            >
                <path d="M18 6 6 18M6 6l12 12" />
            </svg>
        </button>
    );
}
