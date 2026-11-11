import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, Modal, Text, TextInput } from '@gravity-ui/uikit';

import { navSections } from './navItems';
import { filterDestinations } from './destinationFilter';
import styles from './QuickSwitch.module.css';

interface QuickSwitchProps {
  open: boolean;
  onClose: () => void;
  isOwner?: boolean;
  currentPath: string;
  navigate: (path: string) => void;
}

// A list of the pages with a filter: arrows and Enter, or a click. Reaching a page used to mean finding it among twenty sidebar rows.
export function QuickSwitch({ open, onClose, isOwner, currentPath, navigate }: QuickSwitchProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => navSections(isOwner).flat(), [isOwner]);
  const results = useMemo(() => filterDestinations(items, query), [items, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    // jsdom has no scrollIntoView; a browser keeps the highlighted row in view while the arrows walk a long list.
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results]);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[Math.min(active, results.length - 1)].path);
    }
  };

  return (
    // The modal's own focus manager would put focus on the dialog box; the typing field is where it has to be.
    <Modal open={open} onOpenChange={(next) => !next && onClose()} aria-label="Быстрый переход" initialFocus={inputRef}>
      <div className={styles.panel} onKeyDown={onKeyDown}>
        <TextInput
          controlRef={inputRef}
          size="xl"
          value={query}
          onUpdate={(value) => {
            setQuery(value);
            setActive(0);
          }}
          placeholder="Куда перейти? Например: дашборд, vpn, чат"
          controlProps={{ 'aria-label': 'Куда перейти', role: 'combobox', 'aria-expanded': true, 'aria-controls': 'quick-switch-list', 'aria-activedescendant': results[active] ? `quick-switch-${results[active].id}` : undefined }}
        />
        {results.length === 0 ? (
          <Text color="secondary" className={styles.empty}>
            Нет такого раздела
          </Text>
        ) : (
          <ul id="quick-switch-list" role="listbox" aria-label="Разделы" className={styles.list}>
            {results.map((item, index) => (
              <li
                key={item.id}
                id={`quick-switch-${item.id}`}
                ref={index === active ? activeRef : undefined}
                role="option"
                aria-selected={index === active}
                aria-current={item.path === currentPath ? 'page' : undefined}
                className={`${styles.option} ${index === active ? styles.active : ''}`}
                onMouseMove={() => setActive(index)}
                onClick={() => go(item.path)}
              >
                <Icon data={item.icon} size={18} />
                <span className={styles.title}>{item.title}</span>
                {item.path === currentPath && <span className={styles.here}>вы здесь</span>}
              </li>
            ))}
          </ul>
        )}
        <Text color="secondary" variant="caption-2" className={styles.hint}>
          ↑↓ — выбрать · Enter — перейти · Esc — закрыть
        </Text>
      </div>
    </Modal>
  );
}
