import { KeyboardEvent, useEffect, useRef, useState } from 'react';

import { PurgeEntry, useDeleteEntryMutation, useUpdateEntryMutation } from '../../store/api';

/**
 * Bundles the per-row edit/delete state and handlers that `EntryListCard`
 * wires into each `DictionaryEntryRow` — kept as one hook rather than
 * duplicated local state in the list component so the "only one row edits
 * or arms delete at a time" invariant lives in a single place.
 */
export function useDictionaryEditing() {
  const [updateEntryTrigger, { isLoading: isEditSaving }] = useUpdateEntryMutation();
  const [deleteEntryTrigger] = useDeleteEntryMutation();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Delete is two clicks: the first arms the row (and auto-disarms after a
  // few seconds), the second actually deletes. Cheap insurance against the
  // edit/delete icons sitting right next to each other.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
    };
  }, []);

  const handleDeleteEntry = async (id: number) => {
    setDeleteError(null);
    if (editingId === id) setEditingId(null);
    try {
      await deleteEntryTrigger(id).unwrap();
    } catch {
      setDeleteError('Не удалось удалить запись');
    }
  };

  const handleDeleteClick = (id: number) => {
    if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);

    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      void handleDeleteEntry(id);
      return;
    }

    setConfirmDeleteId(id);
    confirmDeleteTimeout.current = setTimeout(() => setConfirmDeleteId(null), 3000);
  };

  const handleStartEdit = (entry: PurgeEntry) => {
    setEditingId(entry.id);
    setEditKey(entry.key);
    setEditValue(entry.value);
    setEditError(null);
    setConfirmDeleteId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (id: number) => {
    const key = editKey.trim();
    const value = editValue.trim();
    if (!key || !value) return;

    setEditError(null);

    try {
      await updateEntryTrigger({ id, key, value }).unwrap();
      setEditingId(null);
    } catch (err) {
      setEditError(typeof err === 'string' ? err : 'Не удалось сохранить изменения');
    }
  };

  const handleEditKeyDown = (id: number) => (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    } else if (event.key === 'Enter' && editKey.trim() && editValue.trim() && !isEditSaving) {
      event.preventDefault();
      void handleSaveEdit(id);
    }
  };

  return {
    editingId,
    editKey,
    editValue,
    editError,
    deleteError,
    isEditSaving,
    confirmDeleteId,
    setEditKey,
    setEditValue,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleEditKeyDown,
    handleDeleteClick,
  };
}
