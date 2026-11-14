/**
 * Общие иконки навигации, используемые в меню шапки и в футере.
 */

type IconProps = { className?: string };

const baseProps = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': true,
} as const;

export function HomeIcon({ className }: IconProps) {
    return (
        <svg {...baseProps} className={className}>
            <path
                fillRule="evenodd"
                d="M12 2.2 1.7 10.4A1.4 1.4 0 0 0 2.6 12.8H3.5V20a2 2 0 0 0 2 2H18.5a2 2 0 0 0 2-2v-7.2h.9a1.4 1.4 0 0 0 .9-2.4L12 2.2ZM10 22v-5.5a2 2 0 0 1 4 0V22h-4Z"
            />
        </svg>
    );
}

export function RouteIcon({ className }: IconProps) {
    return (
        <svg {...baseProps} className={className}>
            <path d="M12 2.2 21.4 21.8 12 17.2 2.6 21.8Z" />
        </svg>
    );
}

export function RunIcon({ className }: IconProps) {
    return (
        <svg {...baseProps} className={className}>
            <path d="M6.8 3.4 20.6 12 6.8 20.6Z" />
        </svg>
    );
}

export function KpiIcon({ className }: IconProps) {
    return (
        <svg {...baseProps} className={className}>
            <rect x="3.5" y="12" width="4" height="9" rx="1" />
            <rect x="10" y="7" width="4" height="14" rx="1" />
            <rect x="16.5" y="3" width="4" height="18" rx="1" />
        </svg>
    );
}

export function ClientsIcon({ className }: IconProps) {
    return (
        <svg {...baseProps} className={className}>
            <circle cx="9" cy="7.6" r="3.4" />
            <path d="M9 12.6c-3.7 0-6.7 2.1-6.7 4.7V19h13.4v-1.7c0-2.6-3-4.7-6.7-4.7Z" />
            <circle cx="17" cy="8.6" r="2.8" />
            <path d="M17 13.1c2.9 0 5.2 1.7 5.2 3.9V19h-4.8v-1.7c0-1.5-.7-2.9-1.9-3.9.5-.2 1-.3 1.5-.3Z" />
        </svg>
    );
}
