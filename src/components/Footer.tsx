import { Link, useLocation } from 'react-router-dom';
import { APP_VERSION_STR } from '@/version';

const NAV_ITEMS = [
  { to: '/reports', label: 'Отчёты' },
  { to: '/route', label: null, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 3.29 3.85 7.72 5.83 9.48A10 10 0 0 0 12 21a10 10 0 0 0 1.17-.52C16.15 16.72 20 12.29 20 9c0-3.87-3.13-7-7-7Z"/><path d="M12 9V5M12 9l3 3M12 9l-3 3"/></svg> },
  { to: '/run', label: 'Запуск' },
  { to: '/kpi', label: 'KPI' },
  { to: '/clients', label: 'Клиенты' },
];

const START_YEAR = 2026;
const currentYear = new Date().getFullYear();
const yearLabel = currentYear === START_YEAR ? String(START_YEAR) : `${START_YEAR}-${String(currentYear).slice(-2)}`;

export function Footer() {
  const location = useLocation();

  return (
    <footer className="footer">
      <nav className="footer-nav" aria-label="Навигация">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`footer-nav-btn${location.pathname === item.to ? ' active' : ''}`}
          >
            {item.label ?? <span className="menu-item-icon">{item.icon}</span>}
          </Link>
        ))}
      </nav>
      <p className="footer-text">
        Vladimir Sokolov · {yearLabel} · <span style={{ fontWeight: 500 }}>Версия:</span> {APP_VERSION_STR}
      </p>
    </footer>
  );
}