import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Footer } from '@/components/Footer';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { PWAInstallDialog } from '@/components/PWAInstallDialog';
import {
  ClientsIcon,
  HomeIcon,
  InstallIcon,
  KpiIcon,
  MoonIcon,
  RouteIcon,
  RunIcon,
  SunIcon,
} from '@/components/navIcons';
import {
  clearInstallPrompt,
  getInstallPrompt,
  isAppInstalled,
  subscribePWAInstall,
  type BeforeInstallPromptEvent,
} from '@/lib/pwaInstall';

type NavItem = { to: string; label: string; icon?: any };

const NAV_ITEMS: NavItem[] = [
  { to: '/reports', label: 'Главная', icon: <HomeIcon /> },
  { to: '/route', label: 'Маршрут', icon: <RouteIcon /> },
  { to: '/run', label: 'Автозапуск', icon: <RunIcon /> },
  { to: '/kpi', label: 'KPI задачи', icon: <KpiIcon /> },
  { to: '/clients', label: 'Клиенты', icon: <ClientsIcon /> },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    () => getInstallPrompt(),
  );
  const [installDialog, setInstallDialog] = useState<{ installed: boolean } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('theme');
        if (stored === 'dark' || stored === 'light') return stored;
      } catch {
        // localStorage недоступен (приватный режим / запрет хранилища)
      }
    }
    return 'light';
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // localStorage недоступен — игнорируем
    }
  }, [theme]);

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => subscribePWAInstall(setInstallPromptEvent), []);

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

  const handleInstall = async () => {
    setMenuOpen(false);

    if (isAppInstalled()) {
      setInstallDialog({ installed: true });
      return;
    }

    const promptEvent = installPromptEvent ?? getInstallPrompt();
    if (!promptEvent) {
      // Браузер не прислал beforeinstallprompt — показываем инструкцию.
      setInstallDialog({ installed: false });
      return;
    }

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      clearInstallPrompt();
      setInstallDialog(choice.outcome === 'accepted' ? null : { installed: false });
    } catch {
      clearInstallPrompt();
      setInstallDialog({ installed: false });
    }
  };

  return (
    <>
      <header className="header">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="brand-icon" />
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
                    {item.icon && <span className="menu-item-icon">{item.icon}</span>}
                    <span className="menu-item-label">{item.label}</span>
                  </Link>
                ))}
                <button
                  type="button"
                  className="menu-item menu-install-button"
                  onClick={handleInstall}
                >
                  <span className="menu-item-icon">
                    <InstallIcon />
                  </span>
                  <span className="menu-item-label">Установить</span>
                </button>
                <button type="button" className="menu-item menu-theme-toggle" onClick={toggleTheme}>
                  <span className="menu-item-icon">
                    {theme === 'light' ? <MoonIcon /> : <SunIcon />}
                  </span>
                  <span className="menu-item-label">
                    {theme === 'light' ? 'Темная тема' : 'Светлая тема'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <PWAInstallPrompt />
      <PWAInstallDialog
        open={installDialog !== null}
        installed={installDialog?.installed ?? false}
        onClose={() => setInstallDialog(null)}
      />
      <main className="main">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}