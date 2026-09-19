import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@gravity-ui/uikit';

import { UnsavedChangesContext } from './use-unsaved-changes';

/**
 * Settings' general form and its Encryption section each track their own
 * dirty state independently (separate save actions), but both need to block
 * the same two exits: closing/reloading the tab, and clicking away via the
 * sidebar. One shared registry avoids duplicating that guard per section.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyIds = useRef(new Set<string>());
  const [isDirty, setIsDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const setDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) {
      dirtyIds.current.add(id);
    } else {
      dirtyIds.current.delete(id);
    }
    setIsDirty(dirtyIds.current.size > 0);
  }, []);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome ignores the message text but still requires returnValue to be set.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const confirmNavigation = useCallback((action: () => void) => {
    if (!isDirty) {
      action();
      return;
    }
    setPendingAction(() => action);
  }, [isDirty]);

  const value = useMemo(() => ({ setDirty, confirmNavigation }), [setDirty, confirmNavigation]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <Dialog open={pendingAction !== null} onClose={() => setPendingAction(null)}>
        <DialogHeader caption="Есть несохранённые изменения" />
        <DialogBody>
          На этой странице есть несохранённые изменения — если уйти сейчас, они будут потеряны.
        </DialogBody>
        <DialogFooter
          textButtonCancel="Остаться"
          textButtonApply="Уйти без сохранения"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonCancel={() => setPendingAction(null)}
          onClickButtonApply={() => {
            const action = pendingAction;
            setPendingAction(null);
            action?.();
          }}
        />
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}
