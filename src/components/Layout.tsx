import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Footer } from '@/components/Footer';

const NAV_ITEMS = [
  { to: '/reports', label: 'Отчёты' },
  { to: '/route', label: null, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 3.29 3.85 7.72 5.83 9.48A10 10 0 0 0 12 21a10 10 0 0 0 1.17-.52C16.15 16.72 20 12.29 20 9c0-3.87-3.13-7-7-7Z"/><path d="M12 9V5M12 9l3 3M12 9l-3 3"/></svg> },
  { to: '/run', label: 'Запуск' },
  { to: '/kpi', label: 'KPI' },
  { to: '/clients', label: 'Клиенты' },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme');
      if (stored === 'dark' || stored === 'light') return stored;
    }
    return 'light';
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (accountRef.current && !accountRef.current.contains(target)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return (
    <>
      <header className="header">
        <div className="brand">
          <img src="/ZOO_opt/icon.svg" alt="" className="brand-icon" />
          ЗооКонтроль
        </div>
        <div className="header-right">
          <div className="menu" ref={accountRef}>
            <button
              type="button"
              className="menu-button"
              aria-label="Аккаунт"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
                <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            {accountOpen && (
              <div className="menu-dropdown account-dropdown">
                <div className="account-name">{user?.email || 'Пользователь'}</div>
                <button type="button" className="btn-signout menu-signout" onClick={() => signOut()}>
                  Выйти
                </button>
              </div>
            )}
          </div>
          <div className="menu" ref={menuRef}>
            <button
              type="button"
              className="menu-button"
              aria-label="Меню"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              ☰
            </button>
            {menuOpen && (
              <div className="menu-dropdown">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`menu-item${location.pathname === item.to ? ' active' : ''}`}
                  >
                    {item.label ?? <span className="menu-item-icon">{item.icon}</span>}
                  </Link>
                ))}
                <button type="button" className="menu-item menu-theme-toggle" onClick={toggleTheme}>
                  {theme === 'light' ? 'Темная тема' : 'Светлая тема'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}