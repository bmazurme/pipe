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

import {
  createEntry,
  deleteEntry,
  getDraftText,
  listEntries,
  PurgeEntry,
  saveDraftText,
  updateEntry,
} from '../shared/api/purge';
import styles from './PurgePage.module.css';

type Direction = 'keyToValue' | 'valueToKey';

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
function suggestUniqueValue(length: number, taken: Set<string>): string {
  if (length <= 0) return '';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = randomToken(length);
    if (!taken.has(candidate)) return candidate;
  }

  return randomToken(length);
}

function buildDictionary(
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

function applyDictionary(
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

interface ImportedEntry {
  key: string;
  value: string;
}

function parseImportedEntries(raw: string): ImportedEntry[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Ожидается JSON-массив вида [{"key": "...", "value": "..."}]');
  }

  return parsed
    .map((item) => ({
      key: typeof item?.key === 'string' ? item.key.trim() : '',
      value: typeof item?.value === 'string' ? item.value.trim() : '',
    }))
    .filter((item) => item.key && item.value);
}

// The result of a replacement stays here — and in the textarea — until the
// user copies it out, surviving tab switches, navigation, page reloads and
// (via the backend) switching devices. localStorage is kept as an instant
// offline mirror; the backend copy is the source of truth on load.
const TEXT_STORAGE_KEY = 'ntlstl-purge-text';
const DRAFT_SAVE_DEBOUNCE_MS = 800;
const DRAFT_POLL_INTERVAL_MS = 4000;

function readStoredText(): string {
  return localStorage.getItem(TEXT_STORAGE_KEY) ?? '';
}

export function PurgePage() {
  const [activeTab, setActiveTab] = useState('apply');
  const [entries, setEntries] = useState<PurgeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const draftLoadedRef = useRef(false);
  const draftSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTextFocused, setIsTextFocused] = useState(false);
  const [hasPendingSave, setHasPendingSave] = useState(false);
  // Set right before a poll-driven setText, so the very next [text] effect
  // run doesn't turn straight around and PUT the value we just fetched.
  const suppressNextSaveRef = useRef(false);
  const [direction, setDirection] = useState<Direction>('keyToValue');
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isValueTouched, setIsValueTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dictError, setDictError] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditSaving, setIsEditSaving] = useState(false);

  // Delete is two clicks: the first arms the row (and auto-disarms after a
  // few seconds), the second actually deletes. Cheap insurance against the
  // edit/delete icons sitting right next to each other.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const confirmDeleteTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const newKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await listEntries();
        if (!cancelled) setEntries(result);
      } catch {
        if (!cancelled) setLoadError('Не удалось загрузить словарь');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const draft = await getDraftText();
        if (cancelled) return;

        if (draft) {
          setText(draft);
        } else {
          // Nothing saved on the backend yet — fall back to whatever this
          // browser had stored locally and push it up so other devices see it.
          const local = readStoredText();
          if (local) {
            setText(local);
            void saveDraftText(local);
          }
        }
      } catch {
        if (!cancelled) setText(readStoredText());
      } finally {
        if (!cancelled) draftLoadedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (text) {
      localStorage.setItem(TEXT_STORAGE_KEY, text);
    } else {
      localStorage.removeItem(TEXT_STORAGE_KEY);
    }

    // Skip syncing the very first render (before the initial backend fetch
    // above has resolved) so we don't overwrite the backend draft with ''.
    if (!draftLoadedRef.current) return;

    // This change came from the poll below picking up another device's
    // save — it's already on the backend, so don't PUT it right back.
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }

    setHasPendingSave(true);
    if (draftSaveTimeout.current) clearTimeout(draftSaveTimeout.current);
    draftSaveTimeout.current = setTimeout(() => {
      void saveDraftText(text).finally(() => setHasPendingSave(false));
    }, DRAFT_SAVE_DEBOUNCE_MS);

    return () => {
      if (draftSaveTimeout.current) clearTimeout(draftSaveTimeout.current);
    };
  }, [text]);

  // Picks up a save made on another open device/tab. Paused while this
  // device is itself typing or has an unsent edit, so an idle poll never
  // clobbers text the user hasn't finished writing yet.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const interval = setInterval(() => {
      if (inFlight || !draftLoadedRef.current || isTextFocused || hasPendingSave) {
        return;
      }

      inFlight = true;
      (async () => {
        try {
          const latest = await getDraftText();
          if (cancelled) return;

          setText((current) => {
            if (latest === current) return current;
            suppressNextSaveRef.current = true;
            return latest;
          });
        } catch {
          // Transient poll failure — try again next tick.
        } finally {
          inFlight = false;
        }
      })();
    }, DRAFT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isTextFocused, hasPendingSave]);

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

    setText(result);
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
      setText('');
      if (draftSaveTimeout.current) clearTimeout(draftSaveTimeout.current);
      void saveDraftText('');
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

    setIsSaving(true);
    setDictError(null);

    try {
      const created = await createEntry(key, value);
      setEntries((prev) =>
        [...prev, created].sort((a, b) => a.key.localeCompare(b.key)),
      );
      setNewKey('');
      setNewValue('');
      setIsValueTouched(false);
    } catch (err) {
      setDictError(
        err instanceof Error ? err.message : 'Не удалось добавить запись',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEntry = async (id: number) => {
    setDictError(null);
    if (editingId === id) setEditingId(null);
    try {
      await deleteEntry(id);
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
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

    setIsEditSaving(true);
    setEditError(null);

    try {
      const updated = await updateEntry(id, key, value);
      setEntries((prev) =>
        prev
          .map((entry) => (entry.id === id ? updated : entry))
          .sort((a, b) => a.key.localeCompare(b.key)),
      );
      setEditingId(null);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Не удалось сохранить изменения',
      );
    } finally {
      setIsEditSaving(false);
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
    link.download = 'purge-dictionary.json';
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
          const created = await createEntry(item.key, item.value);
          setEntries((prev) =>
            [...prev, created].sort((a, b) => a.key.localeCompare(b.key)),
          );
          imported += 1;
        } catch {
          skipped += 1;
        }
      }

      setImportMessage(
        skipped > 0
          ? `Импортировано: ${imported}, пропущено (дубликаты): ${skipped}`
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
                    setText(value);
                    setApplyMessage(null);
                    setCopyMessage(null);
                  }}
                  onKeyDown={handleTextareaKeyDown}
                  onFocus={() => setIsTextFocused(true)}
                  onBlur={() => setIsTextFocused(false)}
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

              {loadError && !isLoading && (
                <Alert theme="danger" view="filled" message={loadError} />
              )}

              {!isLoading && !loadError && entries.length === 0 && (
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
