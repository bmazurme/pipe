import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Book,
  Check,
  Copy,
  Magnifier,
  Pencil,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import {
  Alert,
  Button,
  Card,
  Icon,
  Loader,
  SegmentedRadioGroup,
  Tab,
  TabList,
  TabPanel,
  TabProvider,
  Text,
  TextArea,
  TextInput,
} from '@gravity-ui/uikit';

import { useLocalStorage } from '../shared/hooks/useLocalStorage';
import {
  PurgeEntry,
  purgeApiEndpoints,
  useCreateEntryMutation,
  useDeleteEntryMutation,
  useGetDraftTextQuery,
  useListEntriesQuery,
  useUpdateEntryMutation,
} from '../store/api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  draftTextChanged,
  purgeEntriesSelector,
  purgeLastSyncedTextSelector,
  purgeTextSelector,
} from '../store/slices';
import styles from './PurgePage.module.css';

export type Direction = 'keyToValue' | 'valueToKey';

const SUGGESTION_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function randomToken(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result +=
      SUGGESTION_ALPHABET[Math.floor(Math.random() * SUGGESTION_ALPHABET.length)];
  }
  return result;
}

// Same length as the key, retried a few times against the values already in
// use so the suggestion is unique out of the box — the user can still type
// over it before submitting.
export function suggestUniqueValue(length: number, taken: Set<string>): string {
  if (length <= 0) return '';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = randomToken(length);
    if (!taken.has(candidate)) return candidate;
  }

  return randomToken(length);
}

export function buildDictionary(
  entries: PurgeEntry[],
  direction: Direction,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const entry of entries) {
    const [from, to] =
      direction === 'keyToValue'
        ? [entry.key, entry.value]
        : [entry.value, entry.key];

    if (from && !map.has(from)) {
      map.set(from, to);
    }
  }

  return map;
}

export function applyDictionary(
  text: string,
  dictionary: Map<string, string>,
): { result: string; count: number } {
  if (!dictionary.size || !text) {
    return { result: text, count: 0 };
  }

  // Longest terms first so a multi-word key matches before a shorter one
  // that happens to be its prefix. Plain \b only recognizes ASCII word
  // characters, so it never finds a boundary around Cyrillic text — the
  // \p{L}/\p{N} lookaround below works for any script.
  const terms = [...dictionary.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${terms.join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );

  let count = 0;
  const result = text.replace(pattern, (match) => {
    count += 1;
    return dictionary.get(match) ?? match;
  });

  return { result, count };
}

export interface ImportedEntry {
  key: string;
  value: string;
}

// Matches the file format used by the ntlstl/purge desktop app (a plain
// JSON array of { key, value }, no envelope) so a dictionary exported from
// either app can be imported into the other. That app only requires a
// non-empty `key` — `value` can be missing/empty — so entries are validated
// the same way here; an empty value just won't survive createEntry (the
// backend requires one), which the import loop already reports as skipped.
export function parseImportedEntries(raw: string): ImportedEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Файл повреждён или не является корректным JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Файл должен содержать массив пар { key, value }');
  }

  const entries = parsed.map((item, index) => {
    const key = (item as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error(`Запись №${index + 1}: отсутствует или пустой "key"`);
    }

    const value = (item as { value?: unknown } | null)?.value;
    return {
      key: key.trim(),
      value: typeof value === 'string' ? value.trim() : String(value ?? ''),
    };
  });

  if (entries.length === 0) {
    throw new Error('Файл не содержит ни одной пары');
  }

  return entries;
}

// The result of a replacement stays in the store (and in localStorage) until
// the user copies it out, surviving tab switches, navigation, page reloads
// and (via the backend) switching devices. localStorage is kept as an
// instant offline mirror; the backend copy is the source of truth on load.
const TEXT_STORAGE_KEY = 'ntlstl-purge-text';
const DRAFT_SAVE_DEBOUNCE_MS = 800;
const DRAFT_POLL_INTERVAL_MS = 4000;

export function PurgePage() {
  const dispatch = useAppDispatch();
  const { isLoading, isError: isEntriesError } = useListEntriesQuery();
  const entries = useAppSelector(purgeEntriesSelector);
  const [createEntryTrigger, { isLoading: isSaving }] = useCreateEntryMutation();
  const [updateEntryTrigger, { isLoading: isEditSaving }] = useUpdateEntryMutation();
  const [deleteEntryTrigger] = useDeleteEntryMutation();

  const text = useAppSelector(purgeTextSelector);
  const lastSyncedText = useAppSelector(purgeLastSyncedTextSelector);
  // A local edit not yet confirmed saved — covers the whole typing burst
  // (every keystroke keeps `text` ahead of `lastSyncedText`) and the in-flight
  // PUT itself, so the poll below never clobbers unsent input.
  const hasPendingSave = text !== lastSyncedText;
  const {
    data: initialDraft,
    isSuccess: isDraftSuccess,
    isError: isDraftError,
  } = useGetDraftTextQuery();

  const [activeTab, setActiveTab] = useState('apply');

  const [storedText, setStoredText] = useLocalStorage(TEXT_STORAGE_KEY, '');
  // Only the value at first render matters — it's the offline fallback used
  // once, before the backend draft has loaded.
  const initialStoredTextRef = useRef(storedText);
  const draftLoadedRef = useRef(false);
  const draftSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [direction, setDirection] = useState<Direction>('keyToValue');
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isValueTouched, setIsValueTouched] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Delete is two clicks: the first arms the row (and auto-disarms after a
  // few seconds), the second actually deletes. Cheap insurance against the
  // edit/delete icons sitting right next to each other.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const newKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draftLoadedRef.current) return;

    if (isDraftSuccess) {
      if (!initialDraft?.text && initialStoredTextRef.current) {
        // Nothing saved on the backend yet — fall back to whatever this
        // browser had stored locally and push it up so other devices see it.
        dispatch(draftTextChanged(initialStoredTextRef.current));
        void dispatch(
          purgeApiEndpoints.endpoints.saveDraftText.initiate(
            initialStoredTextRef.current,
          ),
        );
      }
      draftLoadedRef.current = true;
    } else if (isDraftError) {
      dispatch(draftTextChanged(initialStoredTextRef.current));
      draftLoadedRef.current = true;
    }
  }, [isDraftSuccess, isDraftError, initialDraft, dispatch]);

  useEffect(() => {
    setStoredText(text);

    // Skip syncing before the initial backend fetch above has resolved (so
    // we don't overwrite the backend draft with ''), and skip when nothing
    // local differs from what the backend already has (e.g. right after a
    // poll picked up another device's save).
    if (!draftLoadedRef.current || !hasPendingSave) return;

    if (draftSaveTimeout.current) clearTimeout(draftSaveTimeout.current);
    draftSaveTimeout.current = setTimeout(() => {
      void dispatch(purgeApiEndpoints.endpoints.saveDraftText.initiate(text));
    }, DRAFT_SAVE_DEBOUNCE_MS);

    return () => {
      if (draftSaveTimeout.current) clearTimeout(draftSaveTimeout.current);
    };
  }, [text, hasPendingSave, dispatch, setStoredText]);

  // Picks up a save made on another open device/tab. Paused while this
  // device has an unsent edit.
  useEffect(() => {
    let inFlight = false;

    const interval = setInterval(() => {
      if (inFlight || !draftLoadedRef.current || hasPendingSave) return;

      inFlight = true;
      void dispatch(
        purgeApiEndpoints.endpoints.getDraftText.initiate(undefined, {
          forceRefetch: true,
        }),
      ).finally(() => {
        inFlight = false;
      });
    }, DRAFT_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [dispatch, hasPendingSave]);

  useEffect(() => {
    if (activeTab === 'dictionary') {
      newKeyInputRef.current?.focus();
    }
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (confirmDeleteTimeout.current) clearTimeout(confirmDeleteTimeout.current);
    };
  }, []);

  const handleApply = () => {
    const dictionary = buildDictionary(entries, direction);
    const { result, count } = applyDictionary(text, dictionary);

    dispatch(draftTextChanged(result));
    setCopyMessage(null);
    setApplyMessage(
      count > 0
        ? `Заменено слов: ${count}`
        : 'Совпадений со словарём не найдено',
    );
  };

  // The result stays in the field (and in localStorage) until this succeeds —
  // only a confirmed copy clears it, so a failed clipboard write never loses
  // the text.
  const handleCopy = async () => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      dispatch(draftTextChanged(''));
      if (draftSaveTimeout.current) clearTimeout(draftSaveTimeout.current);
      void dispatch(purgeApiEndpoints.endpoints.saveDraftText.initiate(''));
      setApplyMessage(null);
      setCopyMessage('Скопировано в буфер обмена — поле очищено');
    } catch {
      setCopyMessage('Не удалось скопировать — проверьте разрешения браузера');
    }
  };

  const handleKeyChange = (value: string) => {
    setNewKey(value);

    // Keep proposing a fresh same-length value as the key changes, but only
    // until the user actually edits the value field themselves.
    if (!isValueTouched) {
      if (!value) {
        setNewValue('');
      } else {
        const takenValues = new Set(entries.map((entry) => entry.value));
        setNewValue(suggestUniqueValue(value.length, takenValues));
      }
    }
  };

  const handleAddEntry = async () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;

    setDictError(null);

    try {
      await createEntryTrigger({ key, value }).unwrap();
      setNewKey('');
      setNewValue('');
      setIsValueTouched(false);
    } catch (err) {
      setDictError(typeof err === 'string' ? err : 'Не удалось добавить запись');
    }
  };

  const handleDeleteEntry = async (id: number) => {
    setDictError(null);
    if (editingId === id) setEditingId(null);
    try {
      await deleteEntryTrigger(id).unwrap();
    } catch {
      setDictError('Не удалось удалить запись');
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
    confirmDeleteTimeout.current = setTimeout(
      () => setConfirmDeleteId(null),
      3000,
    );
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

  const handleAddFormKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && newKey.trim() && newValue.trim() && !isSaving) {
      event.preventDefault();
      void handleAddEntry();
    }
  };

  const handleEditKeyDown = (id: number) => (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    } else if (
      event.key === 'Enter' &&
      editKey.trim() &&
      editValue.trim() &&
      !isEditSaving
    ) {
      event.preventDefault();
      void handleSaveEdit(id);
    }
  };

  const handleTextareaKeyDown = (event: KeyboardEvent) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter' &&
      text &&
      entries.length > 0
    ) {
      event.preventDefault();
      handleApply();
    }
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
      setEditError(
        typeof err === 'string' ? err : 'Не удалось сохранить изменения',
      );
    }
  };

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;

    return entries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(query) ||
        entry.value.toLowerCase().includes(query),
    );
  }, [entries, searchQuery]);

  const handleExport = () => {
    const data = entries.map(({ key, value }) => ({ key, value }));
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `purge-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    setDictError(null);
    setImportMessage(null);

    try {
      const items = parseImportedEntries(await file.text());

      let imported = 0;
      let skipped = 0;

      // Sequential on purpose: key/value uniqueness is enforced by the
      // backend per request, so concurrent inserts could race each other.
      for (const item of items) {
        try {
          await createEntryTrigger({ key: item.key, value: item.value }).unwrap();
          imported += 1;
        } catch {
          skipped += 1;
        }
      }

      // A skip can now mean a duplicate key/value (our own dictionary rule)
      // or an empty value (ntlstl/purge allows one, our backend doesn't) —
      // no longer just duplicates, so the message stays generic.
      setImportMessage(
        skipped > 0
          ? `Импортировано: ${imported}, пропущено: ${skipped}`
          : `Импортировано: ${imported}`,
      );
    } catch (err) {
      setDictError(
        err instanceof Error ? err.message : 'Не удалось прочитать файл',
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Text variant="header-1" as="h1">
          Purge
        </Text>
        <Text color="secondary">
          Замена слов в тексте по словарю «ключ — значение».
        </Text>
      </div>

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList>
          <Tab value="apply">Применить</Tab>
          <Tab value="dictionary">
            Словарь{entries.length > 0 ? ` (${entries.length})` : ''}
          </Tab>
        </TabList>

        <TabPanel value="apply">
          <div className={styles.tabPanel}>
            <Card view="outlined" className={styles.card}>
              <div className={styles.form}>
                <SegmentedRadioGroup
                  value={direction}
                  onUpdate={(value) => setDirection(value as Direction)}
                  width="max"
                >
                  <SegmentedRadioGroup.Option value="keyToValue">
                    Ключ → значение
                  </SegmentedRadioGroup.Option>
                  <SegmentedRadioGroup.Option value="valueToKey">
                    Значение → ключ
                  </SegmentedRadioGroup.Option>
                </SegmentedRadioGroup>

                <TextArea
                  value={text}
                  onUpdate={(value) => {
                    dispatch(draftTextChanged(value));
                    setApplyMessage(null);
                    setCopyMessage(null);
                  }}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder="Вставьте текст"
                  minRows={10}
                  size="l"
                />

                {applyMessage && <Text color="secondary">{applyMessage}</Text>}
                {copyMessage && <Text color="secondary">{copyMessage}</Text>}

                <div className={styles.buttonRow}>
                  <Button
                    view="action"
                    size="l"
                    disabled={!text || entries.length === 0}
                    title="⌘/Ctrl + Enter"
                    onClick={handleApply}
                  >
                    Сохранить
                  </Button>
                  <Button
                    view="outlined"
                    size="l"
                    disabled={!text}
                    onClick={() => void handleCopy()}
                  >
                    <Icon data={Copy} size={16} />
                    Копировать
                  </Button>
                </div>

                {entries.length === 0 && !isLoading && (
                  <div className={styles.emptyHint}>
                    <Text color="secondary">
                      Словарь пуст — добавьте пары ключ/значение, чтобы начать.
                    </Text>
                    <Button
                      view="flat-action"
                      size="s"
                      onClick={() => setActiveTab('dictionary')}
                    >
                      Перейти к словарю
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </TabPanel>

        <TabPanel value="dictionary">
          <div className={styles.tabPanel}>
            <Card view="outlined" className={styles.card}>
              <div className={styles.addForm}>
                <TextInput
                  controlRef={newKeyInputRef}
                  value={newKey}
                  onUpdate={handleKeyChange}
                  onKeyDown={handleAddFormKeyDown}
                  placeholder="Ключ"
                  size="l"
                />
                <TextInput
                  value={newValue}
                  onUpdate={(value) => {
                    setNewValue(value);
                    setIsValueTouched(true);
                  }}
                  onKeyDown={handleAddFormKeyDown}
                  placeholder="Значение"
                  size="l"
                />
                <Button
                  view="action"
                  size="l"
                  loading={isSaving}
                  disabled={!newKey.trim() || !newValue.trim()}
                  onClick={() => void handleAddEntry()}
                >
                  Добавить
                </Button>
              </div>

              {dictError && (
                <Alert
                  theme="danger"
                  view="filled"
                  message={dictError}
                  onClose={() => setDictError(null)}
                />
              )}
            </Card>

            <Card view="outlined" className={styles.card}>
              <div className={styles.entriesHeader}>
                <Text variant="subheader-2">Записи</Text>
                <div className={styles.toolbar}>
                  <Button
                    view="flat"
                    size="s"
                    disabled={entries.length === 0}
                    onClick={handleExport}
                  >
                    <Icon data={ArrowDownToLine} size={16} />
                    Экспорт
                  </Button>
                  <Button
                    view="flat"
                    size="s"
                    loading={isImporting}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon data={ArrowUpFromLine} size={16} />
                    Импорт
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void handleImportFile(file);
                    }}
                  />
                </div>
              </div>

              {importMessage && (
                <Text color="secondary">{importMessage}</Text>
              )}

              {!isLoading && entries.length > 0 && (
                <TextInput
                  value={searchQuery}
                  onUpdate={setSearchQuery}
                  placeholder="Поиск по ключу или значению"
                  size="m"
                  hasClear
                  startContent={
                    <Icon
                      data={Magnifier}
                      size={16}
                      className={styles.searchIcon}
                    />
                  }
                  className={styles.search}
                />
              )}

              {isLoading && (
                <div className={styles.centered}>
                  <Loader size="m" />
                </div>
              )}

              {isEntriesError && !isLoading && (
                <Alert
                  theme="danger"
                  view="filled"
                  message="Не удалось загрузить словарь"
                />
              )}

              {!isLoading && !isEntriesError && entries.length === 0 && (
                <div className={styles.centered}>
                  <Icon data={Book} size={24} className={styles.emptyIcon} />
                  <Text color="secondary">Словарь пуст</Text>
                </div>
              )}

              {!isLoading && entries.length > 0 && filteredEntries.length === 0 && (
                <div className={styles.centered}>
                  <Icon
                    data={Magnifier}
                    size={24}
                    className={styles.emptyIcon}
                  />
                  <Text color="secondary">Ничего не найдено</Text>
                </div>
              )}

              {!isLoading && filteredEntries.length > 0 && (
                <ul className={styles.entryList}>
                  {filteredEntries.map((entry) =>
                    editingId === entry.id ? (
                      <li key={entry.id} className={styles.entryRow}>
                        <div className={styles.entryEditPair}>
                          <TextInput
                            value={editKey}
                            onUpdate={setEditKey}
                            onKeyDown={handleEditKeyDown(entry.id)}
                            autoFocus
                            size="s"
                          />
                          <Text color="secondary">→</Text>
                          <TextInput
                            value={editValue}
                            onUpdate={setEditValue}
                            onKeyDown={handleEditKeyDown(entry.id)}
                            size="s"
                          />
                        </div>
                        <div className={styles.rowActions}>
                          <Button
                            view="flat"
                            size="s"
                            title="Сохранить"
                            aria-label="Сохранить"
                            loading={isEditSaving}
                            disabled={!editKey.trim() || !editValue.trim()}
                            onClick={() => void handleSaveEdit(entry.id)}
                          >
                            <Icon data={Check} size={16} />
                          </Button>
                          <Button
                            view="flat"
                            size="s"
                            title="Отменить"
                            aria-label="Отменить"
                            onClick={handleCancelEdit}
                          >
                            <Icon data={Xmark} size={16} />
                          </Button>
                        </div>
                        {editError && (
                          <Text color="danger" className={styles.editError}>
                            {editError}
                          </Text>
                        )}
                      </li>
                    ) : (
                      <li key={entry.id} className={styles.entryRow}>
                        <div className={styles.entryPair}>
                          <Text ellipsis>{entry.key}</Text>
                          <Text color="secondary">→</Text>
                          <Text ellipsis>{entry.value}</Text>
                        </div>
                        <div className={styles.rowActions}>
                          <Button
                            view="flat"
                            size="s"
                            title="Изменить"
                            aria-label={`Изменить ${entry.key}`}
                            onClick={() => handleStartEdit(entry)}
                          >
                            <Icon data={Pencil} size={16} />
                          </Button>
                          <Button
                            view={
                              confirmDeleteId === entry.id
                                ? 'flat-danger'
                                : 'flat'
                            }
                            size="s"
                            title={
                              confirmDeleteId === entry.id
                                ? 'Нажмите ещё раз для подтверждения'
                                : 'Удалить'
                            }
                            aria-label={
                              confirmDeleteId === entry.id
                                ? `Подтвердить удаление ${entry.key}`
                                : `Удалить ${entry.key}`
                            }
                            onClick={() => handleDeleteClick(entry.id)}
                          >
                            <Icon data={TrashBin} size={16} />
                          </Button>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </Card>
          </div>
        </TabPanel>
      </TabProvider>
    </div>
  );
}
