import { useRef, useState } from 'react';
import {
  Button, Icon, Text, TextInput, useToaster,
  Dialog, DialogHeader, DialogBody, DialogFooter,
} from '@gravity-ui/uikit';
import { ArrowDownToLine, ArrowUpFromLine, ArrowDownToSquare, ArrowUpFromSquare } from '@gravity-ui/icons';
import type { SettingsBundleType } from '@reports/shared';

import {
  useLazyExportSettingsBundleQuery,
  useImportSettingsBundleMutation,
  useGetSettingsQuery,
  usePushSettingsToBridgeMutation,
  usePullSettingsFromBridgeMutation,
} from '../../store/api';
import { describeError } from '../../utils/describe-error';

import style from './settings.module.css';

function isSettingsBundle(value: unknown): value is SettingsBundleType {
  const bundle = value as Partial<SettingsBundleType> | null;
  return Boolean(bundle && typeof bundle === 'object' && bundle.settings && bundle.subscriptionConfig);
}

// Spans both tabs (general settings + subscription config live in different
// ones, project codes and off-days aren't tabbed at all) — one export/import
// pair for everything a user configures by hand, so moving to a new machine
// isn't retyping each field one at a time. See SettingsBundleType's own
// comment for what's deliberately left out (bridge-sourced calendar data).
function SettingsTransferSection() {
  const toaster = useToaster();
  const { data: settings } = useGetSettingsQuery();
  const [triggerExport, { isFetching: isExporting }] = useLazyExportSettingsBundleQuery();
  const [importBundle, { isLoading: isImporting }] = useImportSettingsBundleMutation();
  const [pushToBridge, { isLoading: isPushing }] = usePushSettingsToBridgeMutation();
  const [pullFromBridge, { isLoading: isPulling }] = usePullSettingsFromBridgeMutation();
  const [pendingBundle, setPendingBundle] = useState<SettingsBundleType | null>(null);
  const [isBridgeImportOpen, setIsBridgeImportOpen] = useState(false);
  const [bridgeForm, setBridgeForm] = useState({ bridgeApiUrl: '', bridgeApiKey: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      const bundle = await triggerExport().unwrap();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `reports-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toaster.add({
        name: 'settings-export-error',
        theme: 'danger',
        title: 'Не удалось экспортировать настройки',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());

      if (!isSettingsBundle(parsed)) {
        throw new Error('Файл не похож на экспорт настроек reports');
      }

      setPendingBundle(parsed);
    } catch (error) {
      toaster.add({
        name: 'settings-import-parse-error',
        theme: 'danger',
        title: 'Не удалось прочитать файл',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handlePushToBridge = async () => {
    try {
      await pushToBridge().unwrap();
      toaster.add({
        name: 'settings-bridge-push-success',
        theme: 'success',
        title: 'Настройки отправлены в bridge',
        autoHiding: 3000,
      });
    } catch (error) {
      toaster.add({
        name: 'settings-bridge-push-error',
        theme: 'danger',
        title: 'Не удалось отправить настройки в bridge',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleOpenBridgeImport = () => {
    setBridgeForm({ bridgeApiUrl: settings?.bridgeApiUrl ?? '', bridgeApiKey: '' });
    setIsBridgeImportOpen(true);
  };

  const handleConfirmBridgeImport = async () => {
    try {
      const { skippedYears } = await pullFromBridge({
        bridgeApiUrl: bridgeForm.bridgeApiUrl || undefined,
        bridgeApiKey: bridgeForm.bridgeApiKey || undefined,
      }).unwrap();

      setIsBridgeImportOpen(false);
      toaster.add({
        name: 'settings-bridge-pull-success',
        theme: 'success',
        title: 'Настройки импортированы из bridge',
        content: skippedYears.length > 0
          ? `Отгулы за ${skippedYears.join(', ')} пропущены — на этой машине ещё нет календаря на эти годы`
          : undefined,
        autoHiding: skippedYears.length > 0 ? false : 3000,
      });
    } catch (error) {
      toaster.add({
        name: 'settings-bridge-pull-error',
        theme: 'danger',
        title: 'Не удалось импортировать настройки из bridge',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingBundle) return;

    try {
      const { skippedYears } = await importBundle(pendingBundle).unwrap();
      setPendingBundle(null);
      toaster.add({
        name: 'settings-import-success',
        theme: 'success',
        title: 'Настройки импортированы',
        content: skippedYears.length > 0
          ? `Отгулы за ${skippedYears.join(', ')} пропущены — на этой машине ещё нет календаря на эти годы`
          : undefined,
        autoHiding: skippedYears.length > 0 ? false : 3000,
      });
    } catch (error) {
      toaster.add({
        name: 'settings-import-error',
        theme: 'danger',
        title: 'Не удалось импортировать настройки',
        content: describeError(error),
        isClosable: true,
      });
    }
  };

  return (
    <section className={style.section}>
      <div className={style.sectionHead}>
        <Text variant="subheader-2">Перенос настроек</Text>
        <Text variant="caption-2" color="secondary">
          Один файл со всем, что настроено вручную — для переезда на другую машину
        </Text>
      </div>

      <Text variant="body-2" color="warning">
        Файл содержит GitLab-токен и ключи bridge в открытом виде — храните его так же осторожно, как пароль
      </Text>

      <div className={style.toolbar}>
        <Button view="outlined" size="m" onClick={() => void handleExport()} loading={isExporting}>
          <Icon data={ArrowDownToLine} size={16} />
          Экспорт всех настроек
        </Button>
        <Button view="outlined" size="m" onClick={() => fileInputRef.current?.click()}>
          <Icon data={ArrowUpFromLine} size={16} />
          Импорт
        </Button>
        <Button view="outlined" size="m" onClick={() => void handlePushToBridge()} loading={isPushing}>
          <Icon data={ArrowUpFromSquare} size={16} />
          Экспорт в Bridge
        </Button>
        <Button view="outlined" size="m" onClick={handleOpenBridgeImport}>
          <Icon data={ArrowDownToSquare} size={16} />
          Импорт из Bridge
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

      <Dialog open={pendingBundle !== null} onClose={() => setPendingBundle(null)}>
        <DialogHeader caption="Импортировать настройки?" />
        <DialogBody>
          Основные настройки, Subscription (отслеживаемые проекты, словарь, шаблоны, шифрование), коды проектов и
          отгулы будут заменены содержимым файла. Действие нельзя отменить.
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setPendingBundle(null)}
          onClickButtonApply={() => void handleConfirmImport()}
          textButtonApply="Импортировать"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger', loading: isImporting }}
        />
      </Dialog>

      <Dialog open={isBridgeImportOpen} onClose={() => setIsBridgeImportOpen(false)}>
        <DialogHeader caption="Импортировать настройки из Bridge?" />
        <DialogBody>
          <Text variant="body-2" color="warning" as="p">
            Основные настройки, Subscription, коды проектов и отгулы будут заменены последним бэкапом с bridge.
            Действие нельзя отменить.
          </Text>
          <div className={style.codeForm}>
            <TextInput
              label="Адрес bridge"
              placeholder="https://bridge.example.com"
              value={bridgeForm.bridgeApiUrl}
              onUpdate={(bridgeApiUrl) => setBridgeForm((prev) => ({ ...prev, bridgeApiUrl }))}
            />
            <TextInput
              label="API-ключ bridge"
              placeholder="оставьте пустым, чтобы использовать сохранённый ключ"
              value={bridgeForm.bridgeApiKey}
              onUpdate={(bridgeApiKey) => setBridgeForm((prev) => ({ ...prev, bridgeApiKey }))}
            />
          </div>
        </DialogBody>
        <DialogFooter
          onClickButtonCancel={() => setIsBridgeImportOpen(false)}
          onClickButtonApply={() => void handleConfirmBridgeImport()}
          textButtonApply="Импортировать"
          textButtonCancel="Отмена"
          propsButtonApply={{ view: 'outlined-danger', loading: isPulling, disabled: !bridgeForm.bridgeApiUrl }}
        />
      </Dialog>
    </section>
  );
}

export default SettingsTransferSection;
