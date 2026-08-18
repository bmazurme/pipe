import { ReactNode, useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { Me } from '../../store/api/users';
import { initAuth, logout, refreshUser } from '../../store/slices/authSlice';

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: Me | null;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// Kicks off the one-time session check on mount. State itself lives in the
// auth slice (Redux), not React context — useAuth() below reads straight
// from the store so every consumer stays in sync without a Provider tree.
export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void dispatch(initAuth());
  }, [dispatch]);

  return <>{children}</>;
}

export function useAuth(): AuthContextValue {
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector((state) => state.auth.isLoading);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const user = useAppSelector((state) => state.auth.user);

  return {
    isLoading,
    isAuthenticated,
    user,
    logout: async () => {
      await dispatch(logout());
    },
    refreshUser: async () => {
      await dispatch(refreshUser()).unwrap();
    },
  };
}
