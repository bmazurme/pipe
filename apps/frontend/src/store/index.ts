import { configureStore } from '@reduxjs/toolkit';

import {
  authApi,
  purgeApi,
  sessionsApi,
  storageApi,
  usersApi,
} from './api';
import authReducer from './slices/auth-slice';
import purgeReducer from './slices/purge-slice';
import sessionsReducer from './slices/sessions-slice';
import storageReducer from './slices/storage-slice';
import usersReducer from './slices/users-slice';

export * from './api';
export * from './slices';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    users: usersReducer,
    storage: storageReducer,
    purge: purgeReducer,
    sessions: sessionsReducer,
    [authApi.reducerPath]: authApi.reducer,
    [usersApi.reducerPath]: usersApi.reducer,
    [storageApi.reducerPath]: storageApi.reducer,
    [purgeApi.reducerPath]: purgeApi.reducer,
    [sessionsApi.reducerPath]: sessionsApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      authApi.middleware,
      usersApi.middleware,
      storageApi.middleware,
      purgeApi.middleware,
      sessionsApi.middleware,
    ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
