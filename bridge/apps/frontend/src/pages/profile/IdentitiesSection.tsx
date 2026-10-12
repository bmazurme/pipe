import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LogoGithub, LogoYandex, TrashBin } from "@gravity-ui/icons";
import {
  ActionTooltip,
  Alert,
  Button,
  Card,
  Icon,
  Skeleton,
  Switch,
  Text,
} from "@gravity-ui/uikit";

import { formatRelativeTime } from "../../shared/lib/formatRelativeTime";
import { SectionHeader } from "../../widgets/SectionHeader";
import {
  AuthProvider,
  getErrorMessage,
  getOauthUrl,
  useGetOauthProvidersQuery,
  useListIdentitiesQuery,
  useSetIdentityEnabledMutation,
  useStartIdentityLinkMutation,
  useUnlinkIdentityMutation,
} from "../../store/api";
import styles from "../ProfilePage.module.css";

const PROVIDERS: Record<
  AuthProvider,
  { title: string; icon: typeof LogoYandex }
> = {
  yandex: { title: "Яндекс ID", icon: LogoYandex },
  github: { title: "GitHub", icon: LogoGithub },
};

const ORDER: AuthProvider[] = ["yandex", "github"];

export function IdentitiesSection() {
  const {
    data: identities = [],
    isLoading,
    isError,
  } = useListIdentitiesQuery();
  const { data: configured } = useGetOauthProvidersQuery();
  const [setEnabled] = useSetIdentityEnabledMutation();
  const [unlink] = useUnlinkIdentityMutation();
  const [startLink] = useStartIdentityLinkMutation();
  const [busy, setBusy] = useState<AuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  // The provider redirects back to /profile?tab=access&linked=… or &linkError=…
  const linked = params.get("linked") as AuthProvider | null;
  const linkError = params.get("linkError");
  const dismissResult = () => {
    const next = new URLSearchParams(params);
    next.delete("linked");
    next.delete("linkError");
    setParams(next, { replace: true });
  };

  const enabledCount = identities.filter((identity) => identity.enabled).length;
  const connected = new Set(identities.map((identity) => identity.provider));
  const connectable = ORDER.filter(
    (provider) =>
      !connected.has(provider) && configured?.providers?.includes(provider),
  );

  const run = async (
    provider: AuthProvider,
    action: () => Promise<unknown>,
  ) => {
    setError(null);
    setBusy(provider);

    try {
      await action();
    } catch (err) {
      setError(getErrorMessage(err, "Не удалось изменить способ входа"));
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = (provider: AuthProvider) =>
    run(provider, async () => {
      const { state } = await startLink(provider).unwrap();

      window.location.assign(getOauthUrl(provider, state));
    });

  return (
    <Card view="outlined" className={styles.card}>
      <div className={styles.form}>
        <SectionHeader title="Способы входа" />

        <Text color="secondary" variant="caption-2">
          Войти можно любым включённым способом. Хотя бы один должен оставаться
          включённым — последний отключить нельзя.
        </Text>

        {linked && PROVIDERS[linked] && (
          <Alert
            theme="success"
            view="filled"
            message={`${PROVIDERS[linked].title} подключён`}
            onClose={dismissResult}
          />
        )}
        {linkError && (
          <Alert
            theme="danger"
            view="filled"
            message={linkError}
            onClose={dismissResult}
          />
        )}
        {(error || isError) && (
          <Alert
            theme="danger"
            view="filled"
            message={error ?? "Не удалось загрузить способы входа"}
          />
        )}

        {isLoading && <Skeleton width="100%" height={48} />}

        {!isLoading && (
          <ul className={styles.deviceList}>
            {identities.map((identity) => {
              const { title, icon } = PROVIDERS[identity.provider];
              const isLastEnabled = identity.enabled && enabledCount <= 1;

              return (
                <li key={identity.provider} className={styles.deviceRow}>
                  <span className={styles.deviceIcon}>
                    <Icon data={icon} size={16} />
                  </span>
                  <div className={styles.deviceInfo}>
                    <Text>{title}</Text>
                    <Text color="secondary" variant="caption-2" ellipsis>
                      {identity.email ?? "без email"}
                      {identity.lastUsedAt
                        ? ` · вход ${formatRelativeTime(identity.lastUsedAt)}`
                        : ""}
                    </Text>
                  </div>
                  <ActionTooltip
                    title={
                      isLastEnabled
                        ? "Нельзя отключить последний способ входа"
                        : ""
                    }
                  >
                    <span>
                      <Switch
                        checked={identity.enabled}
                        disabled={isLastEnabled || busy !== null}
                        onUpdate={(enabled) =>
                          void run(identity.provider, () =>
                            setEnabled({
                              provider: identity.provider,
                              enabled,
                            }).unwrap(),
                          )
                        }
                        controlProps={{ "aria-label": `Вход через ${title}` }}
                      />
                    </span>
                  </ActionTooltip>
                  <ActionTooltip title="Отвязать">
                    <Button
                      view="flat-danger"
                      aria-label={`Отвязать ${title}`}
                      disabled={isLastEnabled || busy !== null}
                      loading={busy === identity.provider}
                      onClick={() =>
                        void run(identity.provider, () =>
                          unlink(identity.provider).unwrap(),
                        )
                      }
                    >
                      <Icon data={TrashBin} size={16} />
                    </Button>
                  </ActionTooltip>
                </li>
              );
            })}
          </ul>
        )}

        {connectable.map((provider) => (
          <Button
            key={provider}
            view="outlined"
            size="l"
            disabled={busy !== null}
            loading={busy === provider}
            onClick={() => void handleConnect(provider)}
          >
            <Icon data={PROVIDERS[provider].icon} size={18} />
            Подключить {PROVIDERS[provider].title}
          </Button>
        ))}
      </div>
    </Card>
  );
}
