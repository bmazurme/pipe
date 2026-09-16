import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { CommentTemplateType, DictionaryEntryType, EncryptionSettingsType, SubscriptionConfigType, TrackedProjectType } from '@reports/shared';

import { generateKeyPair } from './encryption';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, 'subscription-config.json');

const defaultConfig: SubscriptionConfigType = {
  trackedProjects: [],
  dictionary: [],
  commentTemplates: [],
  encryption: { enabled: false, publicKey: '', privateKey: '' },
};

const save = (config: SubscriptionConfigType): SubscriptionConfigType => {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  return config;
};

export const getSubscriptionConfig = (): SubscriptionConfigType => {
  if (!existsSync(configPath)) {
    return defaultConfig;
  }

  return { ...defaultConfig, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
};

export const addTrackedProject = (project: TrackedProjectType): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const trackedProjects = [
    ...config.trackedProjects.filter((item) => item.gitlabProjectId !== project.gitlabProjectId),
    project,
  ];

  return save({ ...config, trackedProjects });
};

export const removeTrackedProject = (gitlabProjectId: string): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const trackedProjects = config.trackedProjects.filter((item) => item.gitlabProjectId !== gitlabProjectId);

  return save({ ...config, trackedProjects });
};

export const findTrackedProject = (gitlabProjectId: string | number): TrackedProjectType | undefined => {
  const { trackedProjects } = getSubscriptionConfig();

  return trackedProjects.find((item) => item.gitlabProjectId === String(gitlabProjectId));
};

export const addDictionaryEntry = (entry: DictionaryEntryType): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const dictionary = [...config.dictionary.filter((item) => item.key !== entry.key), entry];

  return save({ ...config, dictionary });
};

export const removeDictionaryEntry = (key: string): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const dictionary = config.dictionary.filter((item) => item.key !== key);

  return save({ ...config, dictionary });
};

export const updateDictionaryEntry = (oldKey: string, entry: DictionaryEntryType): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const dictionary = [
    ...config.dictionary.filter((item) => item.key !== oldKey && item.key !== entry.key),
    entry,
  ];

  return save({ ...config, dictionary });
};

/** Merges an imported list (e.g. a dictionary exported from bridge's Purge page) into the existing one, upserting by key. */
export const importDictionaryEntries = (entries: DictionaryEntryType[]): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const byKey = new Map(config.dictionary.map((item) => [item.key, item]));

  for (const entry of entries) {
    if (entry.key && entry.value) {
      byKey.set(entry.key, entry);
    }
  }

  return save({ ...config, dictionary: [...byKey.values()] });
};

export const addCommentTemplate = (template: CommentTemplateType): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const commentTemplates = [...config.commentTemplates.filter((item) => item.id !== template.id), template];

  return save({ ...config, commentTemplates });
};

export const removeCommentTemplate = (id: string): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const commentTemplates = config.commentTemplates.filter((item) => item.id !== id);

  return save({ ...config, commentTemplates });
};

export const setEncryptionSettings = (encryption: EncryptionSettingsType): SubscriptionConfigType => {
  const config = getSubscriptionConfig();

  return save({ ...config, encryption });
};

/** Generates a fresh RSA key pair and stores it, leaving `enabled` untouched. */
export const generateAndSaveKeyPair = (): SubscriptionConfigType => {
  const config = getSubscriptionConfig();
  const { publicKey, privateKey } = generateKeyPair();

  return save({ ...config, encryption: { ...config.encryption, publicKey, privateKey } });
};
