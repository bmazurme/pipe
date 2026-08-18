import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppLayout } from './app/layout/AppLayout';
import { AuthProvider } from './app/providers/AuthProvider';
import { AppThemeProvider } from './app/providers/ThemeProvider';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { OAuthErrorPage } from './pages/OAuthErrorPage';
import { ProfilePage } from './pages/ProfilePage';
import { PurgePage } from './pages/PurgePage';
import { StoragePage } from './pages/StoragePage';
import { TimePage } from './pages/TimePage';
import { RequireAuth } from './widgets/RequireAuth';

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
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </AppThemeProvider>
  );
}
