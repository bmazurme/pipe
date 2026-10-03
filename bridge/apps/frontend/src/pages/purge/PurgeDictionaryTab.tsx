import { useState } from 'react';

import styles from '../PurgePage.module.css';
import { AddEntryForm } from './AddEntryForm';
import { EntryListCard } from './EntryListCard';

export function PurgeDictionaryTab() {
  const [showKeys, setShowKeys] = useState(false);

  return (
    <div className={styles.tabPanel}>
      <AddEntryForm showKeys={showKeys} />
      <EntryListCard showKeys={showKeys} onToggleShowKeys={() => setShowKeys((value) => !value)} />
    </div>
  );
}
