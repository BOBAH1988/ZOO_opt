import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

const NAV_ITEMS = [
  { to: '/reports', label: 'Отчёты' },
  { to: '/run', label: 'Запуск процессов' },
  { to: '/clients', label: 'Клиенты' },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const active = location.pathname;

  return (
    <>
      <header className="header">
        <div className="brand">ЗооКонтроль</div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <a key={item.to} href={item.to} className={active === item.to ? 'active' : ''}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="user-area">
          <span>{user?.email || 'Пользователь'}</span>
          <button className="btn-signout" onClick={() => signOut()}>
            Выйти
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </>
  );
}