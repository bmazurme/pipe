// In-memory access token store, kept outside React state so the fetch
// wrapper (http.ts) can read/write it without importing React context.
type Listener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token;
    listeners.forEach((listener) => listener(token));
  },
  subscribe: (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
