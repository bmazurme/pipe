import { Button, Text } from '@gravity-ui/uikit';
import { useLocation, useNavigate } from 'react-router-dom';

import { isModifiedClick } from '../app/layout/layoutUtils';

export function NotFoundPage() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 12,
        padding: 24,
      }}
    >
      <Text as="h1" variant="header-1">
        Страница не найдена
      </Text>
      <Text color="secondary" style={{ wordBreak: 'break-all' }}>
        {location.pathname}
      </Text>
      {/* A real href so it behaves like a link (open in new tab, copy), but a
          plain click is routed instead of reloading the whole document. */}
      <Button
        view="action"
        size="l"
        href="/"
        onClick={(event) => {
          if (isModifiedClick(event)) {
            return;
          }

          event.preventDefault();
          navigate('/');
        }}
      >
        На главную
      </Button>
    </div>
  );
}
