import { Link, useLocation } from 'react-router-dom';
import { APP_VERSION_STR } from '@/version';

type NavItem = { to: string; label?: string; icon?: any; title?: string };

const NAV_ITEMS: NavItem[] = [
  { to: '/reports', title: 'Главная', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12 2.2 1.7 10.4A1.4 1.4 0 0 0 2.6 12.8H3.5V20a2 2 0 0 0 2 2H18.5a2 2 0 0 0 2-2v-7.2h.9a1.4 1.4 0 0 0 .9-2.4L12 2.2ZM10 22v-5.5a2 2 0 0 1 4 0V22h-4Z" /></svg> },
  { to: '/route', title: 'Маршрут', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2 21.4 21.8 12 17.2 2.6 21.8Z" /></svg> },
  { to: '/run', title: 'Запуск', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.8 3.4 20.6 12 6.8 20.6Z" /></svg> },
  { to: '/kpi', label: 'KPI' },
  { to: '/clients', title: 'Клиенты', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="7.6" r="3.4" /><path d="M9 12.6c-3.7 0-6.7 2.1-6.7 4.7V19h13.4v-1.7c0-2.6-3-4.7-6.7-4.7Z" /><circle cx="17" cy="8.6" r="2.8" /><path d="M17 13.1c2.9 0 5.2 1.7 5.2 3.9V19h-4.8v-1.7c0-1.5-.7-2.9-1.9-3.9.5-.2 1-.3 1.5-.3Z" /></svg> },
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
            data-tooltip={item.label ?? item.title}
            aria-label={item.label ?? item.title}
          >
            {item.label ? (
              <span className={`footer-nav-label${item.to === '/kpi' ? ' footer-nav-label--kpi' : ''}`}>{item.label}</span>
            ) : (
              <span className="menu-item-icon">{item.icon}</span>
            )}
          </Link>
        ))}
      </nav>
      <p className="footer-text">
        Vladimir Sokolov · {yearLabel} · <span style={{ fontWeight: 500 }}>Версия:</span> {APP_VERSION_STR}
      </p>
    </footer>
  );
}