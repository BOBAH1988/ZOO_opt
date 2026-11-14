import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export function ProtectedRoute({ emailVerified }: { emailVerified: boolean | null }) {
  const { user, loading, initialized, signOut } = useAuth();

  if (!initialized || loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (emailVerified === false) {
    void signOut();
    return <Navigate to="/login?unverified=1" replace />;
  }

  return <Outlet />;
}