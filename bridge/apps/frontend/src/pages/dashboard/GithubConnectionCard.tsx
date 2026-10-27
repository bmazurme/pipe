import { useEffect, useState } from 'react';
import { LogoGithub } from '@gravity-ui/icons';
import { Alert, Button, Card, Label, Skeleton, Switch, Text, TextInput } from '@gravity-ui/uikit';

import {
  type GithubConnectionCheck,
  type GithubProbeSample,
  getErrorMessage,
  useCheckGithubConnectionMutation,
  useGetGithubConnectionQuery,
  useSaveGithubConnectionMutation,
} from '../../store/api';
import { SectionHeader } from '../../widgets/SectionHeader';
import styles from '../DashboardPage.module.css';

const SOURCE_TEXT = {
  setting: 'выбрано здесь',
  environment: 'задано в окружении стека (GITHUB_PROXY_URL)',
  default: 'по умолчанию',
};

const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`);

const describeSamples = (samples: GithubProbeSample[]) =>
  samples.map((sample) => (sample.ok ? seconds(sample.ms) : `ошибка (${sample.error ?? sample.status})`)).join(' · ');

// What the numbers say, in a sentence: the proxy is worth it when the direct way fails or is slow and the proxy answers.
export function verdict(check: GithubConnectionCheck): { theme: 'success' | 'warning' | 'danger'; text: string } {
  const proxy = check.proxy ?? [];
  const proxyWorks = proxy.length > 0 && proxy.every((sample) => sample.ok);
  const directSlow = check.direct.some((sample) => !sample.ok || sample.ms > 3000);

  if (!proxyWorks) return { theme: 'danger', text: 'Через прокси GitHub не отвечает — проверьте адрес и работу vpn-client; включать его сейчас не нужно.' };
  if (directSlow) return { theme: 'warning', text: 'Напрямую GitHub отвечает медленно или с ошибками, а через прокси стабильно — прокси лучше включить.' };

  return { theme: 'success', text: 'Напрямую GitHub отвечает быстро; прокси можно не включать.' };
}

// How bridge reaches api.github.com — Improve, the CI checks of pull requests, Lab and the VPN workflow all depend on it. Switchable from
// here, no redeploy; «Проверить связь» times a few calls directly and through the proxy so the choice is made on numbers.
export function GithubConnectionCard() {
  const { data, isLoading, isError, error } = useGetGithubConnectionQuery();
  const [save, { isLoading: isSaving, error: saveError }] = useSaveGithubConnectionMutation();
  const [check, { isLoading: isChecking, data: result, error: checkError, reset }] = useCheckGithubConnectionMutation();
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (data) setUrl(data.url ?? '');
  }, [data]);

  const urlChanged = Boolean(data) && url.trim() !== (data?.url ?? '');

  return (
    <Card view="outlined" className={styles.card}>
      <SectionHeader title="GitHub" icon={LogoGithub} />
      {isLoading ? (
        <Skeleton className={styles.statusSkeleton} />
      ) : isError || !data ? (
        <Alert theme="danger" view="filled" message={typeof error === 'string' ? error : getErrorMessage(error, 'Не удалось загрузить настройку')} />
      ) : (
        <>
          <div className={styles.row}>
            <Label theme={data.enabled ? 'info' : 'normal'}>{data.enabled ? 'через прокси' : 'напрямую'}</Label>
            <Text color="secondary" variant="caption-2">
              {SOURCE_TEXT[data.source] ?? ''}
            </Text>
          </div>
          <Text color="secondary" variant="caption-2">
            Запросы bridge к GitHub (Improve, проверки CI, Lab). Если с платы GitHub отвечает медленно и запросы заканчиваются «aborted due to timeout»,
            пустите их через VPN-клиент стека.
          </Text>
          <Switch
            checked={data.enabled}
            disabled={isSaving || urlChanged}
            onUpdate={(enabled) => void save({ enabled, url: data.url ?? undefined })}
            content="Через прокси (VPN-клиент)"
          />
          {urlChanged && (
            <Text color="secondary" variant="caption-2">
              Сначала сохраните адрес
            </Text>
          )}
          <TextInput label="Адрес прокси" value={url} onUpdate={setUrl} disabled={isSaving} placeholder="http://vpn-client:1080" />
          <div className={styles.row}>
            {urlChanged && (
              <Button view="action" size="m" loading={isSaving} onClick={() => void save({ enabled: data.enabled, url: url.trim() })}>
                Сохранить адрес
              </Button>
            )}
            <Button view="outlined" size="m" loading={isChecking} onClick={() => void check({ url: url.trim() || undefined })}>
              Проверить связь
            </Button>
          </div>
          {saveError && <Alert theme="danger" view="filled" message={typeof saveError === 'string' ? saveError : getErrorMessage(saveError, 'Не удалось сохранить настройку')} />}
          {checkError && <Alert theme="danger" view="filled" message={typeof checkError === 'string' ? checkError : getErrorMessage(checkError, 'Не удалось проверить связь')} />}
          {result && (
            <div className={styles.list}>
              <Text variant="caption-2">Напрямую: {describeSamples(result.direct)}</Text>
              <Text variant="caption-2">Через прокси: {result.proxy ? describeSamples(result.proxy) : '—'}</Text>
              <Alert theme={verdict(result).theme} view="outlined" message={verdict(result).text} />
              <Button view="flat" size="s" onClick={() => reset()}>
                Скрыть
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
