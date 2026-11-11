import { APP_VERSION_STR } from '@/version';

const START_YEAR = 2026;
const currentYear = new Date().getFullYear();
const yearLabel = currentYear === START_YEAR ? String(START_YEAR) : `${START_YEAR}-${String(currentYear).slice(-2)}`;

export function Footer() {
  return (
    <footer style={{
      marginTop: 'auto',
      padding: '8px 24px',
      textAlign: 'center',
      color: '#6b7280',
      fontSize: '12px',
      borderTop: '1px solid #e5e7eb',
    }}>
      <p>
        {yearLabel} · <span style={{ fontWeight: 500 }}>Версия:</span> {APP_VERSION_STR}
      </p>
    </footer>
  );
}