import { Link, useLocation } from 'react-router-dom';
import { APP_VERSION_STR } from '@/version';

type NavItem = { to: string; label?: string; icon?: any };

const NAV_ITEMS: NavItem[] = [
  { to: '/reports', label: 'Отчёты' },
  { to: '/route', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M12 5l-7 7M12 5l7 7"/></svg> },
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