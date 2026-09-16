import { useState, type FormEvent } from 'react';
import {
  Button, TextInput, Text, Icon, Dialog, DialogHeader, DialogBody, DialogFooter, useToaster,
  TabProvider, TabList, Tab, TabPanel,
} from '@gravity-ui/uikit';
import { CodeFork, Eye, EyeSlash, Gear, Plus, TrashBin } from '@gravity-ui/icons';

import { settingsSelector, setSettings, type SettingsState } from '../../store';
import { useSetSettingsMutation, useGetProjectDictQuery, useAddProjectCodeMutation, useRemoveProjectCodeMutation } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { describeError } from '../../utils/describe-error';
import PageHeader from '../../components/page-header';
import TrackedProjectsSection from './tracked-projects-section';
import DictionarySection from './dictionary-section';
import CommentTemplatesSection from './comment-templates-section';
import EncryptionSection from './encryption-section';

import style from './settings.module.css';

function Settings() {
  const dispatch = useAppDispatch();
  const toaster = useToaster();
  const settings = useAppSelector(settingsSelector);
  const [form, setForm] = useState<SettingsState>(settings);
  const [syncedSettings, setSyncedSettings] = useState(settings);
  const [showToken, setShowToken] = useState(false);
  const [showBridgeKey, setShowBridgeKey] = useState(false);
  const [showBridgeRefreshToken, setShowBridgeRefreshToken] = useState(false);
  const [setSettingsRequest, { isLoading: isSaving }] = useSetSettingsMutation();
  const [activeTab, setActiveTab] = useState('general');

  useDocumentTitle('Настройки');

  if (settings !== syncedSettings) {
    setSyncedSettings(settings);
    setForm(settings);
  }

  const { data: projectDict = {} } = useGetProjectDictQuery();
  const [addProjectCode] = useAddProjectCodeMutation();
  const [removeProjectCode] = useRemoveProjectCodeMutation();
  const [isCodeDialogOpen, setIsCodeDialogOpen] = useState(false);
  const [codeForm, setCodeForm] = useState({ code: '', label: '' });
  const [codeToRemove, setCodeToRemove] = useState<string | null>(null);

  const codes = Object.entries(projectDict);
  const isDirty = JSON.stringify(form) !== JSON.stringify(settings);
  const isDuplicateCode = Boolean(codeForm.code) && codeForm.code in projectDict;

  const handleChange = (key: keyof SettingsState) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

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
        />
        <TabProvider value={activeTab} onUpdate={setActiveTab}>
          <TabList className={style.tabs}>
            <Tab value="general" icon={<Icon data={Gear} size={16} />} label={{ content: 'Основные' }} />
            <Tab value="subscription" icon={<Icon data={CodeFork} size={16} />} label={{ content: 'Subscription' }} />
          </TabList>

          <TabPanel value="general" className={style.page}>
          <form className={style.form} onSubmit={handleSubmit}>
            <section className={style.section}>
              <div className={style.sectionHead}>
                <Text variant="subheader-2">Подключение к GitLab</Text>
                <Text variant="caption-2" color="secondary">
                  Откуда берутся задачи и списанное время
                </Text>
              </div>
              <div className={style.group}>
                <TextInput
                  label="GitLab URL"
                  placeholder="https://gitlab.com/api/v4"
                  value={form.gitlabUrl}
                  onUpdate={handleChange('gitlabUrl')}
                  autoComplete="off"
                />
                <TextInput
                  label="Токен доступа"
                  type={showToken ? 'text' : 'password'}
                  value={form.privateToken}
                  onUpdate={handleChange('privateToken')}
                  autoComplete="off"
                  note="Personal access token с правом read_api"
                  endContent={(
                    <Button
                      view="flat"
                      size="s"
                      onClick={() => setShowToken((prev) => !prev)}
                      aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                    >
                      <Icon data={showToken ? EyeSlash : Eye} size={16} />
                    </Button>
                  )}
                />
              </div>
            </section>

            <section className={style.section}>
              <div className={style.sectionHead}>
                <Text variant="subheader-2">Реквизиты отчёта</Text>
                <Text variant="caption-2" color="secondary">
                  Подставляются в имя и шапку выгружаемого файла
                </Text>
              </div>
              <div className={style.group}>
                <TextInput
                  label="ID пользователя"
                  placeholder="123"
                  value={form.userId}
                  onUpdate={handleChange('userId')}
                />
                <TextInput
                  label="Сотрудник"
                  placeholder="Иванов И. И."
                  value={form.employee}
                  onUpdate={handleChange('employee')}
                />
                <TextInput
                  label="Компания"
                  placeholder="Название компании"
                  value={form.company}
                  onUpdate={handleChange('company')}
                />
              </div>
            </section>

            <section className={style.section}>
              <div className={style.sectionHead}>
                <Text variant="subheader-2">Интеграция с bridge</Text>
                <Text variant="caption-2" color="secondary">
                  Импорт отгулов и отправка готового отчёта
                </Text>
              </div>
              <div className={style.group}>
                <TextInput
                  label="Bridge API URL"
                  placeholder="http://localhost:3002/api/v1/time"
                  value={form.bridgeApiUrl}
                  onUpdate={handleChange('bridgeApiUrl')}
                  autoComplete="off"
                />
                <TextInput
                  label="Bridge API key"
                  type={showBridgeKey ? 'text' : 'password'}
                  value={form.bridgeApiKey}
                  onUpdate={handleChange('bridgeApiKey')}
                  autoComplete="off"
                  endContent={(
                    <Button
                      view="flat"
                      size="s"
                      onClick={() => setShowBridgeKey((prev) => !prev)}
                      aria-label={showBridgeKey ? 'Скрыть ключ' : 'Показать ключ'}
                    >
                      <Icon data={showBridgeKey ? EyeSlash : Eye} size={16} />
                    </Button>
                  )}
                />
                <TextInput
                  label="Bridge refresh token"
                  type={showBridgeRefreshToken ? 'text' : 'password'}
                  value={form.bridgeRefreshToken}
                  onUpdate={handleChange('bridgeRefreshToken')}
                  autoComplete="off"
                  note="Значение cookie bridgeRefreshToken из браузера после входа в bridge — нужно для Subscription (push/pull через bridge Storage)"
                  endContent={(
                    <Button
                      view="flat"
                      size="s"
                      onClick={() => setShowBridgeRefreshToken((prev) => !prev)}
                      aria-label={showBridgeRefreshToken ? 'Скрыть токен' : 'Показать токен'}
                    >
                      <Icon data={showBridgeRefreshToken ? EyeSlash : Eye} size={16} />
                    </Button>
                  )}
                />
              </div>
            </section>

            <div className={style.formActions}>
              <Button view="action" size="l" type="submit" loading={isSaving} disabled={!isDirty}>
                Сохранить
              </Button>
              {isDirty && (
                <Button view="flat" size="l" type="button" onClick={() => setForm(settings)}>
                  Отменить
                </Button>
              )}
              <Text variant="caption-2" color="secondary" className={style.dirtyHint}>
                {isDirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
              </Text>
            </div>
          </form>

          <section className={style.codes}>
            <div className={style.sectionHead}>
              <Text variant="subheader-2">Коды проектов</Text>
              <Text variant="caption-2" color="secondary">
                Сопоставление ID проекта GitLab с названием в отчёте
              </Text>
            </div>
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
          </section>
          </TabPanel>

          <TabPanel value="subscription" className={style.page}>
            <TrackedProjectsSection />
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
