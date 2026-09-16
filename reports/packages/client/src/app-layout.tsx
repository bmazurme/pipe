import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Button, Icon } from '@gravity-ui/uikit';
import { CircleQuestion } from '@gravity-ui/icons';
import { Routes, Route, Link } from 'react-router-dom';

import Home from './pages/home';
import { EmptyState, ErrorState, PageSkeleton } from './components/state';
import { useGetCountsQuery, useGetReportsQuery, useGetSettingsQuery } from './store/api';
import { reportSelector, setSettings } from './store';
import { useAppDispatch, useAppSelector } from './hooks';
import { describeError } from './utils/describe-error';

import './App.css';

// Split off the routes that pull heavy dependencies (date pickers, dialogs)
const CalendarPage = lazy(() => import('./pages/calendar'));
const Settings = lazy(() => import('./pages/settings'));
const Subscription = lazy(() => import('./pages/subscription'));

function AppLayout() {
  const dispatch = useAppDispatch();
  const state = useAppSelector(reportSelector);

  const counts = useGetCountsQuery(state.year);
  const reports = useGetReportsQuery();
  const { data: settingsData } = useGetSettingsQuery();

  useEffect(() => {
    if (settingsData) {
      dispatch(setSettings(settingsData));
    }
  }, [settingsData, dispatch]);

  const retry = () => {
    counts.refetch();
    reports.refetch();
  };

  /**
   * Renders a page only once the data it actually depends on is there.
   * Settings stay reachable no matter what: a broken GitLab token is exactly
   * the case where the user needs to get to that page.
   */
  const guard = (node: ReactNode, { needsReports }: { needsReports: boolean }) => {
    const isLoading = counts.isLoading || (needsReports && reports.isLoading);
    const failure = counts.error ?? (needsReports ? reports.error : undefined);

    if (isLoading) {
      return <PageSkeleton />;
    }

    if (failure || !counts.data) {
      return (
        <ErrorState
          message={describeError(failure, 'Не удалось получить данные с сервера')}
          onRetry={retry}
          action={(
            <Button view="outlined" size="m" component={Link} to="/settings">
              Открыть настройки
            </Button>
          )}
        />
      );
    }

    return node;
  };

  const reportData = reports.data ?? [];
  const report = reportData.map((x, i) => ({
    ...x,
    id: i.toString(),
    meta: { sort: true },
  }));
  const total = reportData.reduce((a, x) => a + x.time, 0);
  const issues = reportData.length;
  const closed = reportData.reduce((a, x) => a + (x.status === 'Закрыта' ? 1 : 0), 0);

  return (
    <Routes>
      <Route
        path="/"
        element={guard(
          <Home
            month={state.month}
            year={state.year}
            total={total}
            data={counts.data!}
            issues={issues}
            closed={closed}
            report={report}
          />,
          { needsReports: true },
        )}
      />
      <Route
        path="/calendar"
        element={guard(
          <Suspense fallback={<PageSkeleton />}>
            <CalendarPage data={counts.data!} year={state.year} />
          </Suspense>,
          { needsReports: false },
        )}
      />
      <Route
        path="/settings"
        element={(
          <Suspense fallback={<PageSkeleton />}>
            <Settings />
          </Suspense>
        )}
      />
      <Route
        path="/subscription"
        element={(
          <Suspense fallback={<PageSkeleton />}>
            <Subscription />
          </Suspense>
        )}
      />
      <Route
        path="*"
        element={(
          <EmptyState
            icon={<Icon data={CircleQuestion} size={28} />}
            title="Страница не найдена"
            description="Проверьте адрес или вернитесь к отчёту."
            action={(
              <Button view="action" size="m" component={Link} to="/">
                К отчёту
              </Button>
            )}
          />
        )}
      />
    </Routes>
  )
}

export default AppLayout;
