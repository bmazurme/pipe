import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia, which Gravity UI's theme/layout hooks
// (and our own useIsMobile) rely on.
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);

// jsdom doesn't implement URL.createObjectURL/revokeObjectURL, used for
// client-side file export/download.
URL.createObjectURL = URL.createObjectURL ?? (() => 'blob:mock');
URL.revokeObjectURL = URL.revokeObjectURL ?? (() => {});
