import { useMemo } from 'react';

interface ProgressRingProps {
  percent: number | null;
  size?: number;
  thickness?: number;
}

/** Кольцевой индикатор прогресса (SVG). percent: 0..1 или null (неизвестно). */
export function ProgressRing({ percent, size = 48, thickness = 4 }: ProgressRingProps) {
  const radius = useMemo(() => (size - thickness) / 2, [size, thickness]);
  const circumference = useMemo(() => 2 * Math.PI * radius, [radius]);
  const strokeDasharray = useMemo(() => {
    if (percent === null) return '62.8, 62.8';
    return `${circumference} ${circumference}`;
  }, [percent, circumference]);
  const strokeDashoffset = useMemo(() => {
    if (percent === null) return 62.8;
    return circumference * (1 - Math.max(0, Math.min(1, percent)));
  }, [percent, circumference]);

  return (
    <div style={{ width: size, height: size, margin: '0 auto', position: 'relative' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{ transform: 'rotate(-90deg)', display: 'block', margin: '0 auto' }}
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="var(--color-border)"
          strokeWidth="4"
          fill="none"
        />
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke={percent === null ? 'var(--color-border)' : 'var(--color-primary)'}
          strokeWidth="4"
          fill="none"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--color-text)',
          whiteSpace: 'nowrap',
        }}
      >
        {percent === null ? '—' : `${Math.round(percent * 100)}%`}
      </div>
    </div>
  );
}