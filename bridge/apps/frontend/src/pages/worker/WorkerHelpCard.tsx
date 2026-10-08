import { useState } from 'react';
import { Button, Card, Text } from '@gravity-ui/uikit';
import { Link } from 'react-router-dom';

import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../WorkerPage.module.css';
import { HELP_TOPICS, HelpTopic } from './workerHelp';

function Topic({ topic }: { topic: HelpTopic }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={styles.helpTopic}>
      <button
        type="button"
        className={styles.helpTopicHeader}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className={styles.helpTopicTitle}>
          <Text variant="body-2">{topic.title}</Text>
          <Text variant="caption-2" color="secondary">
            {topic.usedFor}
          </Text>
        </span>
        <Text color="secondary">{isOpen ? '−' : '+'}</Text>
      </button>

      {isOpen && (
        <div className={styles.helpTopicBody}>
          <ol className={styles.helpSteps}>
            {topic.steps.map((step) => (
              <li key={step}>
                <Text variant="body-1">{step}</Text>
              </li>
            ))}
          </ol>
          <Text variant="body-1">
            <b>Куда вставить:</b> {topic.whereToPut}
          </Text>
          {topic.note && (
            <Text variant="caption-2" color="warning">
              {topic.note}
            </Text>
          )}
          <div className={styles.helpLinks}>
            {topic.links.map((link) =>
              link.external ? (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer noopener">
                  {link.label} ↗
                </a>
              ) : (
                <Link key={link.href} to={link.href}>
                  {link.label}
                </Link>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Collapsed by default, like the key form next to it: it is read once, when setting the
// worker up, and would otherwise push the recurring parts of the page further down.
export function WorkerHelpCard() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader
        title="Справка: токены и ключи"
        actions={
          <Button view="flat" size="s" onClick={() => setIsExpanded((value) => !value)}>
            {isExpanded ? 'Скрыть' : 'Показать'}
          </Button>
        }
      />

      {isExpanded && (
        <>
          <Text color="secondary" variant="caption-2">
            Какие ключи нужны для какой модели, где их получить и куда вставить. Ключи нужны только для тех моделей, которыми вы
            пользуетесь.
          </Text>
          {HELP_TOPICS.map((topic) => (
            <Topic key={topic.id} topic={topic} />
          ))}
        </>
      )}
    </Card>
  );
}
