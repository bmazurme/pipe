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

// jsdom doesn't implement ResizeObserver, which Gravity UI's Select (with a
// label) and TextArea measure their content with.
globalThis.ResizeObserver =
  globalThis.ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

// Node 25+ ships its own experimental `localStorage` global, which (without --localstorage-file) is a broken stub that
// shadows jsdom's and has no working methods — tests touching localStorage then fail on newer Node than CI's pinned 22.
// Install a plain in-memory Storage whenever the one in place is unusable.
function storageWorks(): boolean {
  try {
    return typeof window.localStorage?.clear === 'function';
  } catch {
    return false;
  }
}

if (!storageWorks()) {
  const makeStorage = (): Storage => {
    let data = new Map<string, string>();

    return {
      get length() {
        return data.size;
      },
      clear: () => {
        data = new Map();
      },
      getItem: (key) => data.get(key) ?? null,
      key: (index) => [...data.keys()][index] ?? null,
      removeItem: (key) => {
        data.delete(key);
      },
      setItem: (key, value) => {
        data.set(key, String(value));
      },
    };
  };

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(window, name, { value: makeStorage(), configurable: true });
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
  }
}
