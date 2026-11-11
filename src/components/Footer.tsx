import { APP_VERSION_STR } from '@/version';

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
        <span style={{ fontWeight: 500 }}>Версия:</span> {APP_VERSION_STR}
      </p>
    </footer>
  );
}