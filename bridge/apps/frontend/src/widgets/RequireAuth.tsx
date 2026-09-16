import { Navigate, Outlet } from 'react-router-dom';
import { Loader } from '@gravity-ui/uikit';

import { useAuth } from '../app/providers/AuthProvider';
import styles from './RequireAuth.module.css';

export function RequireAuth() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className={styles.loaderWrapper}>
        <Loader size="m" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
