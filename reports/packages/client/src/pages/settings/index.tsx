import { useState, type FormEvent } from 'react';
import {
  Button, TextInput, Text, Icon, Dialog, DialogHeader, DialogBody, DialogFooter, useToaster,
  TabProvider, TabList, Tab, TabPanel,
} from '@gravity-ui/uikit';
import { ArrowsRotateRight, CodeFork, Eye, EyeSlash, Gear, Plus, TrashBin } from '@gravity-ui/icons';

import { settingsSelector, setSettings, type SettingsState } from '../../store';
import { useSetSettingsMutation, useGetProjectDictQuery, useAddProjectCodeMutation, useRemoveProjectCodeMutation } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes';
import { describeError } from '../../utils/describe-error';
import PageHeader from '../../components/page-header';
import TrackedProjectsSection from './tracked-projects-section';
import MigrationsSection from './migrations-section';
import DictionarySection from './dictionary-section';
import CommentTemplatesSection from './comment-templates-section';
import EncryptionSection from './encryption-section';
import SettingsTransferSection from './settings-transfer-section';
import ConnectionCheckPanel from './connection-check-panel';
import { Field } from './field';
import { useConnectionChecks } from './use-connection-checks';

import style from './settings.module.css';

// Empty is fine (the integration is simply off); anything else must be an http(s) address.
function urlProblem(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();

  if (!trimmed) return undefined;

  try {
    const { protocol } = new URL(trimmed);

    return protocol === 'http:' || protocol === 'https:' ? undefined : 'Адрес должен начинаться с http:// или https://';
  } catch {
    return 'Это не похоже на адрес: ожидается вид https://хост/путь';
  }
}

type SecretInputProps = {
  label: string;
  value: string;
  onUpdate: (value: string) => void;
  hint?: string;
  revealLabel: string;
  hideLabel: string;
};

// A password-style field with its own show/hide toggle, so the form keeps no per-secret state.
function SecretInput({ label, value, onUpdate, hint, revealLabel, hideLabel }: SecretInputProps) {
  const [shown, setShown] = useState(false);

  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <TextInput
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onUpdate={onUpdate}
          autoComplete="off"
          endContent={(
            <Button view="flat" size="s" onClick={() => setShown((prev) => !prev)} aria-label={shown ? hideLabel : revealLabel}>
              <Icon data={shown ? EyeSlash : Eye} size={16} />
            </Button>
          )}
        />
      )}
    </Field>
  );
}

function Settings() {
  const dispatch = useAppDispatch();
  const toaster = useToaster();
  const settings = useAppSelector(settingsSelector);
  const [form, setForm] = useState<SettingsState>(settings);
  const [syncedSettings, setSyncedSettings] = useState(settings);
  const [setSettingsRequest, { isLoading: isSaving }] = useSetSettingsMutation();
  const [activeTab, setActiveTab] = useState('general');

  useDocumentTitle('Настройки');

  if (settings !== syncedSettings) {
    setSyncedSettings(settings);
    setForm(settings);
  }

  const checks = useConnectionChecks(form);

  const { data: projectDict = {} } = useGetProjectDictQuery();
  const [addProjectCode] = useAddProjectCodeMutation();
  const [removeProjectCode] = useRemoveProjectCodeMutation();
  const [isCodeDialogOpen, setIsCodeDialogOpen] = useState(false);
  const [codeForm, setCodeForm] = useState({ code: '', label: '' });
  const [codeToRemove, setCodeToRemove] = useState<string | null>(null);

  const codes = Object.entries(projectDict);
  const isDirty = JSON.stringify(form) !== JSON.stringify(settings);
  const isDuplicateCode = Boolean(codeForm.code) && codeForm.code in projectDict;

  const gitlabUrlProblem = urlProblem(form.gitlabUrl);
  const bridgeUrlProblem = urlProblem(form.bridgeApiUrl);
  const hasProblems = Boolean(gitlabUrlProblem || bridgeUrlProblem);
  const gitlabUrlHint = !gitlabUrlProblem && (form.gitlabUrl ?? '').trim() && !/\/api\/v\d/.test(form.gitlabUrl ?? '')
    ? 'Обычно адрес заканчивается на /api/v4'
    : undefined;

  useUnsavedChangesGuard('settings-general', isDirty);

  const handleChange = (key: keyof SettingsState) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!isDirty || hasProblems) {
      return;
    }

    try {
      const saved = await setSettingsRequest(form).unwrap();

      dispatch(setSettings(saved));
      toaster.add({
        name: 'settings-saved',
        theme: 'success',
        title: 'Настройки сохранены',
        autoHiding: 3000,
      });
    } catch (error) {
      toaster.add({
        name: 'settings-save-error',
        theme: 'danger',
        title: 'Не удалось сохранить настройки',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleAddCode = async () => {
    if (!codeForm.code || !codeForm.label || isDuplicateCode) {
      return;
    }

    const payload = codeForm;

    setIsCodeDialogOpen(false);
    setCodeForm({ code: '', label: '' });

    try {
      await addProjectCode(payload).unwrap();
    } catch (error) {
      toaster.add({
        name: 'code-add-error',
        theme: 'danger',
        title: 'Не удалось добавить код',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleRemoveCode = async () => {
    const code = codeToRemove;

    setCodeToRemove(null);

    if (!code) {
      return;
    }

    try {
      await removeProjectCode({ code }).unwrap();
    } catch (error) {
      toaster.add({
        name: 'code-remove-error',
        theme: 'danger',
        title: 'Не удалось удалить код',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  return (
    <>
      <div className={style.wrapper}>
        <PageHeader
          title="Настройки"
          description="Подключение к GitLab, реквизиты отчёта и интеграция с bridge"
          actions={(
            <Button view="outlined" size="m" loading={checks.anyLoading} onClick={() => void checks.runAll()}>
              <Icon data={ArrowsRotateRight} size={16} />
              Проверить все соединения
            </Button>
          )}
        />
        <SettingsTransferSection />
        <TabProvider value={activeTab} onUpdate={setActiveTab}>
          <TabList className={style.tabs}>
            <Tab value="general" icon={<Icon data={Gear} size={16} />}>Основные</Tab>
            <Tab value="subscription" icon={<Icon data={CodeFork} size={16} />}>Subscription</Tab>
          </TabList>

          <TabPanel value="general" className={style.pageWide}>
          <form
            className={style.form}
            onSubmit={handleSubmit}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                event.currentTarget.requestSubmit();
              }
            }}
          >
            <div className={style.columns}>
              <div className={style.col}>
                <section className={style.section}>
                  <div className={style.sectionHead}>
                    <Text variant="subheader-2">Подключение к GitLab</Text>
                    <Text variant="caption-2" color="secondary">
                      Откуда берутся задачи и списанное время
                    </Text>
                  </div>
                  <div className={style.group}>
                    <Field label="GitLab URL" error={gitlabUrlProblem} hint={gitlabUrlHint}>
                      {(id) => (
                        <TextInput
                          id={id}
                          placeholder="https://gitlab.com/api/v4"
                          value={form.gitlabUrl}
                          onUpdate={handleChange('gitlabUrl')}
                          autoComplete="off"
                          validationState={gitlabUrlProblem ? 'invalid' : undefined}
                        />
                      )}
                    </Field>
                    <SecretInput
                      label="Токен доступа"
                      value={form.privateToken}
                      onUpdate={handleChange('privateToken')}
                      hint="Personal access token с правом read_api"
                      revealLabel="Показать токен"
                      hideLabel="Скрыть токен"
                    />
                    <ConnectionCheckPanel
                      label="GitLab"
                      state={checks.stateOf('gitlab')}
                      onRun={() => void checks.run('gitlab')}
                      disabledReason={!(form.gitlabUrl ?? '').trim() || !form.privateToken ? 'Укажите URL и токен' : gitlabUrlProblem}
                    />
                  </div>
                </section>

                <section className={style.section}>
                  <div className={style.sectionHead}>
                    <Text variant="subheader-2">Интеграция с bridge</Text>
                    <Text variant="caption-2" color="secondary">
                      Обмен задачами, отгулы и отправка готового отчёта
                    </Text>
                  </div>
                  <div className={style.group}>
                    <Field label="Bridge API URL" error={bridgeUrlProblem}>
                      {(id) => (
                        <TextInput
                          id={id}
                          placeholder="https://bridge.example.com/api/v1"
                          value={form.bridgeApiUrl}
                          onUpdate={handleChange('bridgeApiUrl')}
                          autoComplete="off"
                          validationState={bridgeUrlProblem ? 'invalid' : undefined}
                        />
                      )}
                    </Field>
                    <SecretInput
                      label="Bridge API key"
                      value={form.bridgeApiKey}
                      onUpdate={handleChange('bridgeApiKey')}
                      hint="Личный API-ключ (Профиль → API-ключи в bridge): один на всё — отгулы, отчёт, обмен задачами, автопилот и обновления"
                      revealLabel="Показать ключ"
                      hideLabel="Скрыть ключ"
                    />
                    <ConnectionCheckPanel
                      label="Bridge"
                      state={checks.stateOf('bridge')}
                      onRun={() => void checks.run('bridge')}
                      disabledReason={!(form.bridgeApiUrl ?? '').trim() ? 'Укажите Bridge API URL' : bridgeUrlProblem}
                    />
                  </div>
                </section>

              </div>

              <div className={style.col}>
                <section className={style.section}>
                  <div className={style.sectionHead}>
                    <Text variant="subheader-2">Реквизиты отчёта</Text>
                    <Text variant="caption-2" color="secondary">
                      Подставляются в имя и шапку выгружаемого файла
                    </Text>
                  </div>
                  <div className={style.group}>
                    <Field label="ID пользователя" hint="Ваш ID в GitLab: с ним сверяется токен при проверке соединения">
                      {(id) => <TextInput id={id} placeholder="123" value={form.userId} onUpdate={handleChange('userId')} />}
                    </Field>
                    <Field label="Сотрудник">
                      {(id) => <TextInput id={id} placeholder="Иванов И. И." value={form.employee} onUpdate={handleChange('employee')} />}
                    </Field>
                    <Field label="Компания">
                      {(id) => <TextInput id={id} placeholder="Название компании" value={form.company} onUpdate={handleChange('company')} />}
                    </Field>
                  </div>
                </section>

                <section className={style.section}>
                  <div className={style.sectionHead}>
                    <Text variant="subheader-2">Коды проектов</Text>
                    <Text variant="caption-2" color="secondary">
                      Сопоставление ID проекта GitLab с названием в отчёте
                    </Text>
                  </div>
                  <div className={style.group}>
                  {codes.length === 0 ? (
                    <Text variant="body-2" color="secondary" className={style.codesEmpty}>
                      Коды ещё не добавлены
                    </Text>
                  ) : (
                    <ul className={style.codesList}>
                      {codes.map(([code, label]) => (
                        <li key={code} className={style.codesItem}>
                          <span className={style.codesCode}>{code}</span>
                          <span className={style.codesLabel}>{label}</span>
                          <Button
                            view="flat"
                            size="s"
                            onClick={() => setCodeToRemove(code)}
                            aria-label={`Удалить код ${code}`}
                            className={style.codesRemove}
                          >
                            <Icon data={TrashBin} size={16} />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    view="outlined"
                    size="m"
                    width="max"
                    onClick={() => setIsCodeDialogOpen(true)}
                    className={style.codesAdd}
                  >
                    <Icon data={Plus} size={16} />
                    Добавить код
                  </Button>
                            </div>
                </section>

                <section className={style.section}>
                  <div className={style.sectionHead}>
                    <Text variant="subheader-2">Подключение к GitHub</Text>
                    <Text variant="caption-2" color="secondary">
                      Нужно только для отслеживания GitHub-репозиториев
                    </Text>
                  </div>
                  <div className={style.group}>
                    <Text variant="body-1" color="secondary">
                      Токен задаётся в <code>packages/server/.env</code> (<code>GITHUB_TOKEN</code>) и здесь не хранится,
                      чтобы не попадать в экспорт настроек.
                    </Text>
                    <ConnectionCheckPanel
                      label="GitHub"
                      state={checks.stateOf('github')}
                      onRun={() => void checks.run('github')}
                    />
                  </div>
                </section>
              </div>
            </div>

            <div className={style.formActions}>
              <Button view="action" size="l" type="submit" loading={isSaving} disabled={!isDirty || hasProblems}>
                Сохранить
              </Button>
              {isDirty && (
                <Button view="flat" size="l" type="button" onClick={() => setForm(settings)}>
                  Отменить
                </Button>
              )}
              <Text variant="caption-2" color="secondary" className={style.dirtyHint}>
                {hasProblems ? 'Исправьте адрес, чтобы сохранить' : isDirty ? 'Есть несохранённые изменения (Ctrl+S — сохранить)' : 'Все изменения сохранены'}
              </Text>
            </div>
          </form>

          </TabPanel>

          <TabPanel value="subscription" className={style.page}>
            <TrackedProjectsSection />
            <MigrationsSection />
            <DictionarySection />
            <CommentTemplatesSection />
            <EncryptionSection />
          </TabPanel>
        </TabProvider>
      </div>

      <Dialog open={isCodeDialogOpen} onClose={() => setIsCodeDialogOpen(false)}>
        <DialogHeader caption="Добавить код" />
        <DialogBody>
          <div className={style.codeForm}>
            <TextInput
              label="Код"
              placeholder="ID проекта в GitLab"
              value={codeForm.code}
              onUpdate={(code) => setCodeForm((prev) => ({ ...prev, code }))}
              validationState={isDuplicateCode ? 'invalid' : undefined}
              errorMessage={isDuplicateCode ? 'Такой код уже есть' : undefined}
            />
            <TextInput
              label="Название"
              placeholder="Название проекта в отчёте"
              value={codeForm.label}
              onUpdate={(label) => setCodeForm((prev) => ({ ...prev, label }))}
            />
          </div>
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setIsCodeDialogOpen(false)}
          onClickButtonApply={handleAddCode}
          textButtonApply="Добавить"
          textButtonCancel="Отмена"
          propsButtonApply={{ disabled: !codeForm.code || !codeForm.label || isDuplicateCode }}
        />
      </Dialog>

      <Dialog open={!!codeToRemove} onClose={() => setCodeToRemove(null)}>
        <DialogHeader caption="Удалить код" />
        <DialogBody>
          Удалить {codeToRemove}: {codeToRemove && projectDict[codeToRemove]} из списка кодов проектов?
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setCodeToRemove(null)}
          onClickButtonApply={handleRemoveCode}
          textButtonApply="Удалить"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger' }}
        />
      </Dialog>
    </>
  )
}

export default Settings;
