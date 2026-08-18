import { useEffect, useRef, useState } from 'react';
import { Tab, TabList, TabPanel, TabProvider } from '@gravity-ui/uikit';

import { useLocalStorage } from '../shared/hooks/useLocalStorage';
import { purgeApiEndpoints, useGetDraftTextQuery } from '../store/api';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  draftTextChanged,
  purgeEntriesSelector,
  purgeLastSyncedTextSelector,
  purgeTextSelector,
} from '../store/slices';
import { PageHeader } from '../widgets/PageHeader';
import { PurgeApplyTab } from './purge/PurgeApplyTab';
import { PurgeDictionaryTab } from './purge/PurgeDictionaryTab';
import styles from './PurgePage.module.css';

// The result of a replacement stays in the store (and in localStorage) until
// the user copies it out, surviving tab switches, navigation, page reloads
// and (via the backend) switching devices. localStorage is kept as an
// instant offline mirror; the backend copy is the source of truth on load.
const TEXT_STORAGE_KEY = 'ntlstl-purge-text';
const DRAFT_SAVE_DEBOUNCE_MS = 800;
const DRAFT_POLL_INTERVAL_MS = 4000;

export function PurgePage() {
  const dispatch = useAppDispatch();
  const entries = useAppSelector(purgeEntriesSelector);
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

  // These three effects own the whole draft-text sync engine and must stay
  // mounted regardless of which tab is active — hence living here rather
  // than inside PurgeApplyTab, which unmounts with its TabPanel.
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

  return (
    <div className={styles.page}>
      <PageHeader
        title="Purge"
        description="Замена слов в тексте по словарю «ключ — значение»."
      />

      <TabProvider value={activeTab} onUpdate={setActiveTab}>
        <TabList>
          <Tab value="apply">Применить</Tab>
          <Tab value="dictionary">
            Словарь{entries.length > 0 ? ` (${entries.length})` : ''}
          </Tab>
        </TabList>

        <TabPanel value="apply">
          <PurgeApplyTab onGoToDictionary={() => setActiveTab('dictionary')} />
        </TabPanel>

        <TabPanel value="dictionary">
          <PurgeDictionaryTab isActive={activeTab === 'dictionary'} />
        </TabPanel>
      </TabProvider>
    </div>
  );
}
