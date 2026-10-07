import { configureStore } from '@reduxjs/toolkit';

import {
  apiKeysApi,
  authApi,
  chatApi,
  logsApi,
  purgeApi,
  secretsApi,
  sessionsApi,
  storageApi,
  timeApi,
  usersApi,
  vpnApi,
  workerApi,
} from './api';
import authReducer from './slices/auth-slice';
import apiKeysReducer from './slices/api-keys-slice';
import purgeReducer from './slices/purge-slice';
import sessionsReducer from './slices/sessions-slice';
import storageReducer from './slices/storage-slice';
import timeReducer from './slices/time-slice';
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
    apiKeys: apiKeysReducer,
    time: timeReducer,
    [authApi.reducerPath]: authApi.reducer,
    [usersApi.reducerPath]: usersApi.reducer,
    [storageApi.reducerPath]: storageApi.reducer,
    [purgeApi.reducerPath]: purgeApi.reducer,
    [secretsApi.reducerPath]: secretsApi.reducer,
    [sessionsApi.reducerPath]: sessionsApi.reducer,
    [apiKeysApi.reducerPath]: apiKeysApi.reducer,
    [timeApi.reducerPath]: timeApi.reducer,
    [workerApi.reducerPath]: workerApi.reducer,
    [chatApi.reducerPath]: chatApi.reducer,
    [vpnApi.reducerPath]: vpnApi.reducer,
    [logsApi.reducerPath]: logsApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      authApi.middleware,
      usersApi.middleware,
      storageApi.middleware,
      purgeApi.middleware,
      secretsApi.middleware,
      sessionsApi.middleware,
      apiKeysApi.middleware,
      timeApi.middleware,
      workerApi.middleware,
      chatApi.middleware,
      vpnApi.middleware,
      logsApi.middleware,
    ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
