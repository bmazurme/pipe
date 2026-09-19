import { createContext, useContext, useEffect } from 'react';

export interface UnsavedChangesContextValue {
  setDirty: (id: string, dirty: boolean) => void;
  confirmNavigation: (action: () => void) => void;
}

export const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

/** Registers `isDirty` under `id` for as long as the calling component is mounted. */
export function useUnsavedChangesGuard(id: string, isDirty: boolean) {
  const ctx = useContext(UnsavedChangesContext);

  useEffect(() => {
    ctx?.setDirty(id, isDirty);
  }, [ctx, id, isDirty]);

  useEffect(() => () => ctx?.setDirty(id, false), [ctx, id]);
}

/** Runs `action` immediately if nothing is dirty, otherwise prompts to confirm first. */
export function useConfirmNavigation() {
  const ctx = useContext(UnsavedChangesContext);
  return ctx?.confirmNavigation ?? ((action: () => void) => action());
}
