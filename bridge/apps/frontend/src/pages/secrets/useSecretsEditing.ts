import { KeyboardEvent, useEffect, useRef, useState } from 'react';

import {
  Secret,
  useDeleteSecretMutation,
  useRevealSecretMutation,
  useUpdateSecretMutation,
} from '../../store/api';

/**
 * Bundles the per-row edit/delete/reveal state SecretListCard wires into
 * each SecretRow — one hook rather than duplicated local state in the list
 * component, same reasoning as Purge's useDictionaryEditing (only one row
 * edits or arms delete at a time).
 */
export function useSecretsEditing() {
  const [updateSecretTrigger, { isLoading: isEditSaving }] = useUpdateSecretMutation();
  const [deleteSecretTrigger] = useDeleteSecretMutation();
  const [revealSecretTrigger] = useRevealSecretMutation();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  // Left empty means "keep the current value" — the edit form never shows
  // the existing value, so there's nothing to leave unchanged except by
  // omitting it from the request entirely.
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Delete is two clicks, same as Purge's dictionary rows: the first arms
  // the row (auto-disarms after a few seconds), the second deletes.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Revealed values live only in this component's memory, keyed by id —
  // never in the RTK Query cache, so a revealed value can't leak into a
  // later re-render from a stale cache entry and disappears for good on
  // unmount/navigation.
  const [revealedValues, setRevealedValues] = useState<Record<number, string>>({});
  const [revealingId, setRevealingId] = useState<number | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
    };
  }, []);

  const hideRevealed = (id: number) => {
    setRevealedValues((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleToggleReveal = async (id: number) => {
    if (id in revealedValues) {
      hideRevealed(id);
      return;
    }

    setRevealError(null);
    setRevealingId(id);
    try {
      const { value } = await revealSecretTrigger(id).unwrap();
      setRevealedValues((prev) => ({ ...prev, [id]: value }));
    } catch {
      setRevealError('Не удалось получить значение секрета');
    } finally {
      setRevealingId(null);
    }
  };

  const handleDeleteSecret = async (id: number) => {
    setDeleteError(null);
    if (editingId === id) setEditingId(null);
    hideRevealed(id);

    try {
      await deleteSecretTrigger(id).unwrap();
    } catch {
      setDeleteError('Не удалось удалить секрет');
    }
  };

  const handleDeleteClick = (id: number) => {
    if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);

    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      void handleDeleteSecret(id);
      return;
    }

    setConfirmDeleteId(id);
    confirmDeleteTimeout.current = setTimeout(() => setConfirmDeleteId(null), 3000);
  };

  const handleStartEdit = (secret: Secret) => {
    setEditingId(secret.id);
    setEditName(secret.name);
    setEditDescription(secret.description ?? '');
    setEditValue('');
    setEditError(null);
    setConfirmDeleteId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (id: number) => {
    const name = editName.trim();
    if (!name) return;

    setEditError(null);

    try {
      await updateSecretTrigger({
        id,
        name,
        description: editDescription.trim(),
        ...(editValue.trim() ? { value: editValue.trim() } : {}),
      }).unwrap();
      setEditingId(null);
    } catch (err) {
      setEditError(typeof err === 'string' ? err : 'Не удалось сохранить изменения');
    }
  };

  const handleEditKeyDown = (id: number) => (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    } else if (event.key === 'Enter' && editName.trim() && !isEditSaving) {
      event.preventDefault();
      void handleSaveEdit(id);
    }
  };

  return {
    editingId,
    editName,
    editDescription,
    editValue,
    editError,
    deleteError,
    isEditSaving,
    confirmDeleteId,
    revealedValues,
    revealingId,
    revealError,
    setEditName,
    setEditDescription,
    setEditValue,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleEditKeyDown,
    handleDeleteClick,
    handleToggleReveal,
  };
}
