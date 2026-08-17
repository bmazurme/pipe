import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { checkAuth, logout as logoutRequest } from '../../shared/api/auth';
import { tokenStore } from '../../shared/api/token-store';
import { fetchMe, Me } from '../../shared/api/users';

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: Me | null;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await checkAuth();

      if (cancelled) return;

      if (result.isAuthenticated && result.accessToken) {
        tokenStore.set(result.accessToken);

        try {
          const me = await fetchMe();
          if (!cancelled) {
            setUser(me);
            setIsAuthenticated(true);
          }
        } catch {
          if (!cancelled) setIsAuthenticated(false);
        }
      }

      if (!cancelled) setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    tokenStore.set(null);
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await fetchMe();
    setUser(me);
  }, []);

  return (
    <AuthContext.Provider
      value={{ isLoading, isAuthenticated, user, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
