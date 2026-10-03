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

// jsdom doesn't implement IntersectionObserver, which Gravity UI's Select
// popup uses (useIntersection, for its "load more" sentinel) the moment its
// option list actually renders — opening any populated Select in a test
// throws without this, same class of gap as the two above.
window.IntersectionObserver =
  window.IntersectionObserver ??
  (class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver);
