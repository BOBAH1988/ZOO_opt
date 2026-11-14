import { Link, useLocation } from 'react-router-dom';
import { APP_VERSION_STR } from '@/version';
import { ClientsIcon, HomeIcon, KpiIcon, RouteIcon, RunIcon } from '@/components/navIcons';

type NavItem = { to: string; title: string; icon: any };

const NAV_ITEMS: NavItem[] = [
  { to: '/reports', title: 'Главная', icon: <HomeIcon /> },
  { to: '/route', title: 'Маршрут', icon: <RouteIcon /> },
  { to: '/run', title: 'Автозапуск', icon: <RunIcon /> },
  { to: '/kpi', title: 'KPI задачи', icon: <KpiIcon /> },
  { to: '/clients', title: 'Клиенты', icon: <ClientsIcon /> },
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
            data-tooltip={item.title}
            aria-label={item.title}
          >
            {item.icon}
          </Link>
        ))}
      </nav>
      <p className="footer-text">
        Vladimir Sokolov · {yearLabel} · <span style={{ fontWeight: 500 }}>Версия:</span> {APP_VERSION_STR}
      </p>
    </footer>
  );
}