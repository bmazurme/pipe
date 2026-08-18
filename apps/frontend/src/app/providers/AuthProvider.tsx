import { ReactNode } from 'react';

import {
  Me,
  useCheckAuthQuery,
  useGetMeQuery,
  useLogoutMutation,
  usersApiEndpoints,
} from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { usersLoadingSelector, usersSelector } from '../../store/slices';

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: Me | null;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// checkAuth runs on mount; getMe only fires once isAuthenticated flips true
// (auth-slice's own matcher sets that from checkAuth's result). Both feed
// users-slice via matchers, so no component-side orchestration is needed —
// this component only has to keep the queries subscribed.
export function AuthProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

  useCheckAuthQuery();
  useGetMeQuery(undefined, { skip: !isAuthenticated });

  return <>{children}</>;
}

export function useAuth(): AuthContextValue {
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector(usersLoadingSelector);
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const user = useAppSelector(usersSelector);
  const [logoutMutation] = useLogoutMutation();

  return {
    isLoading,
    isAuthenticated,
    user,
    logout: async () => {
      await logoutMutation();
    },
    refreshUser: async () => {
      await dispatch(
        usersApiEndpoints.endpoints.getMe.initiate(undefined, { forceRefetch: true }),
      ).unwrap();
    },
  };
}
