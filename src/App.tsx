import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Layout } from '@/components/Layout';
import { Login } from '@/components/Login';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ReportsPage } from '@/pages/ReportsPage';
import { RunProcessesPage } from '@/pages/RunProcessesPage';
import { ClientsPage } from '@/pages/ClientsPage';

export default function App() {
  const { initialized, loading, user } = useAuth();

  if (!initialized || loading) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#6b7280' }}>
        Инициализация…
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={() => {}} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login onLogin={() => {}} />} />
      <Route path="/" element={<Navigate to="/reports" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="reports" element={<ReportsPage />} />
          <Route path="run" element={<RunProcessesPage />} />
          <Route path="clients" element={<ClientsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/reports" replace />} />
    </Routes>
  );
}