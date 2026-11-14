interface ProgressRingProps {
  percent: number | null;
  size?: number;
  thickness?: number;
}

const VIEWBOX_SIZE = 24;

/** Кольцевой индикатор прогресса (SVG). percent: 0..1 или null (неизвестно). */
export function ProgressRing({ percent, size = 56, thickness = 3 }: ProgressRingProps) {
  const radius = (VIEWBOX_SIZE - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const safePercent = percent === null ? null : Math.max(0, Math.min(1, percent));
  const strokeDashoffset = safePercent === null ? circumference : circumference * (1 - safePercent);

  return (
    <div className="stat-ring" style={{ maxWidth: size }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        style={{ transform: 'rotate(-90deg)', display: 'block' }}
      >
        <circle
          cx={VIEWBOX_SIZE / 2}
          cy={VIEWBOX_SIZE / 2}
          r={radius}
          stroke="var(--color-border)"
          strokeWidth={thickness}
          fill="none"
        />
        <circle
          cx={VIEWBOX_SIZE / 2}
          cy={VIEWBOX_SIZE / 2}
          r={radius}
          stroke={percent === null ? 'var(--color-border)' : 'var(--color-primary)'}
          strokeWidth={thickness}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div className="stat-ring-value">
        {percent === null ? '—' : `${Math.round(percent * 100)}%`}
      </div>
    </div>
  );
}
