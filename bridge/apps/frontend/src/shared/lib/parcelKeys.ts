import { useLocalStorage } from '../hooks/useLocalStorage';

export interface StoredParcelKey {
  id: string;
  name: string;
  pem: string;
}

const STORAGE_KEY = 'pipe.parcelKeys';

// Named RSA keys (private, for opening/decrypting a parcel; public, for
// encrypting one for a recipient) kept only in this browser's localStorage
// — never sent to bridge. Matches the rest of this app's encryption model:
// bridge/worker only ever see ciphertext bytes, the key itself stays
// client-side (see shared/lib/parcelCrypto.ts's own comment on this).
export function useParcelKeys(): {
  keys: StoredParcelKey[];
  addKey: (name: string, pem: string) => void;
  removeKey: (id: string) => void;
} {
  const [keys, setKeys] = useLocalStorage<StoredParcelKey[]>(STORAGE_KEY, []);

  const addKey = (name: string, pem: string) => {
    setKeys([...keys, { id: crypto.randomUUID(), name, pem }]);
  };

  const removeKey = (id: string) => {
    setKeys(keys.filter((key) => key.id !== id));
  };

  return { keys, addKey, removeKey };
}
