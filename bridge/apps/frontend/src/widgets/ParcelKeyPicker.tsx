import { Select } from '@gravity-ui/uikit';

import { StoredParcelKey } from '../shared/lib/parcelKeys';

interface ParcelKeyPickerProps {
  keys: StoredParcelKey[];
  onPick: (pem: string) => void;
  placeholder?: string;
}

// A one-shot "insert" control, not a persistent selection: picking a saved
// key fills the caller's own field (a TextArea the user can still edit
// afterwards) rather than binding to it, so it stays usable even for a key
// that was never imported — paste it directly into that field instead.
export function ParcelKeyPicker({ keys, onPick, placeholder = 'Сохранённый ключ…' }: ParcelKeyPickerProps) {
  if (keys.length === 0) return null;

  return (
    <Select
      placeholder={placeholder}
      value={[]}
      onUpdate={([id]) => {
        const key = keys.find((candidate) => candidate.id === id);
        if (key) onPick(key.pem);
      }}
      options={keys.map((key) => ({ value: key.id, content: key.name }))}
      width="max"
    />
  );
}
