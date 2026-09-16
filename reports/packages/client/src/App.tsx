import { useEffect, useMemo } from 'react';
import { ThemeProvider, Toaster, ToasterComponent, ToasterProvider } from '@gravity-ui/uikit';

import { useTheme } from './hooks/use-theme';
import AppLayout from './app-layout';
import Content from './components/content';

import './App.css';

const toaster = new Toaster();

function App() {
  const { isDark } = useTheme();
  const theme = isDark ? 'dark' : 'light';
  const mobile = useMemo(() => window.matchMedia('(max-width: 768px)').matches, []);

  useEffect(() => {
    // Keeps native controls (scrollbars, form widgets) in sync with the app theme
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <ThemeProvider theme={theme}>
      <ToasterProvider toaster={toaster}>
        <Content sidebar main={<AppLayout />} />
        <ToasterComponent mobile={mobile} />
      </ToasterProvider>
    </ThemeProvider>
  )
}

export default App;
