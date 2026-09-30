import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from './ui.jsx';

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="center-screen">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Wrap admin-only controls; viewers see a read-only note instead. */
export function AdminOnly({ children, fallback = null }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : fallback;
}
