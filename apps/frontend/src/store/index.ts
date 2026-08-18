import { configureStore } from '@reduxjs/toolkit';

import { authReducer } from './slices/authSlice';
import { purgeReducer } from './slices/purgeSlice';
import { sessionsReducer } from './slices/sessionsSlice';
import { storageReducer } from './slices/storageSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    storage: storageReducer,
    purge: purgeReducer,
    sessions: sessionsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
