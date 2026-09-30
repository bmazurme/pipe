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

// jsdom doesn't implement Element.scrollTo, which @gravity-ui/aikit's
// useSmartScroll calls in a passive effect on every message-list update —
// without this it throws an unhandled error outside any test's own
// assertions (and still fails the run) rather than a real test failure.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
