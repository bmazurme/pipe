import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppLayout } from './app/layout/AppLayout';
import { AuthProvider } from './app/providers/AuthProvider';
import { AppThemeProvider } from './app/providers/ThemeProvider';
import { LoginPage } from './pages/LoginPage';
import { OAuthErrorPage } from './pages/OAuthErrorPage';
import { RequireAuth } from './widgets/RequireAuth';

// The authenticated pages carry the heavy dependencies — the calendar pulls in
// @gravity-ui/date-components, Storage pulls in the zip encoder — and none of
// them is needed to paint the login screen or the shell. Split per route so a
// cold load ships the shell plus one page instead of the whole app. Login and
// the OAuth error page stay eager: they are the first paint for a signed-out
// visitor, and a chunk request there would just delay it.
const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const StoragePage = lazy(() =>
  import('./pages/StoragePage').then((m) => ({ default: m.StoragePage })),
);
const PurgePage = lazy(() =>
  import('./pages/PurgePage').then((m) => ({ default: m.PurgePage })),
);
const TimePage = lazy(() =>
  import('./pages/TimePage').then((m) => ({ default: m.TimePage })),
);
const WorkerPage = lazy(() =>
  import('./pages/WorkerPage').then((m) => ({ default: m.WorkerPage })),
);

export function App() {
  return (
    <AppThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/oauth-error" element={<OAuthErrorPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/storage" element={<StoragePage />} />
                <Route path="/purge" element={<PurgePage />} />
                <Route path="/time" element={<TimePage />} />
                <Route path="/worker" element={<WorkerPage />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </AppThemeProvider>
  );
}
