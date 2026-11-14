import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Layout } from '@/components/Layout';
import { Login } from '@/components/Login';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ReportsPage } from '@/pages/ReportsPage';
import { RoutePage } from '@/pages/RoutePage';
import { RunProcessesPage } from '@/pages/RunProcessesPage';
import { KpiPage } from '@/pages/KpiPage';
import { ClientsPage } from '@/pages/ClientsPage';

export default function App() {
  const { initialized, loading, user, emailVerified } = useAuth();

  if (!initialized || loading) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#6b7280' }}>
        Инициализация…
      </div>
    );
  }

  return (
    <div className="app">
      {user ? (
        <Routes>
          <Route path="/login" element={<Login onLogin={() => {}} />} />
          <Route path="/" element={<Navigate to="/reports" replace />} />
          <Route element={<ProtectedRoute emailVerified={emailVerified} />}>
            <Route element={<Layout />}>
              <Route path="reports" element={<ReportsPage />} />
              <Route path="route" element={<RoutePage />} />
              <Route path="run" element={<RunProcessesPage />} />
              <Route path="kpi" element={<KpiPage />} />
              <Route path="clients" element={<ClientsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      ) : (
        <Login onLogin={() => {}} />
      )}
    </div>
  );
}