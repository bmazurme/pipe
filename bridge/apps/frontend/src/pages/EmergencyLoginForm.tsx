import { FormEvent, useState } from "react";
import { Button, Text, TextInput } from "@gravity-ui/uikit";

import { useEmergencyLoginMutation } from "../store/api";

function describeFailure(error: unknown): string {
  const status = (error as { status?: number } | undefined)?.status;

  if (status === 401) return "Неверный или отозванный ключ";
  if (status === 429) return "Слишком много попыток — подождите минуту";

  return "Не удалось войти";
}

// The last resort on the login page, for when neither Yandex nor GitHub works. Collapsed by default so it never
// competes with the normal buttons; on success the session check runs again and LoginPage redirects.
export function EmergencyLoginForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [key, setKey] = useState("");
  const [login, { isLoading, error }] = useEmergencyLoginMutation();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (key.trim()) {
      void login(key.trim());
    }
  };

  if (!isOpen) {
    return (
      <Button view="flat-secondary" size="m" width="max" onClick={() => setIsOpen(true)}>
        Аварийный вход по ключу
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Аварийный вход">
      <TextInput
        type="password"
        size="l"
        value={key}
        onUpdate={setKey}
        placeholder="Аварийный ключ (bre_…)"
        autoFocus
        hasClear
        autoComplete="off"
        validationState={error ? "invalid" : undefined}
        errorMessage={error ? describeFailure(error) : undefined}
      />
      <Button type="submit" view="outlined" size="l" width="max" loading={isLoading} disabled={!key.trim()}>
        Войти по ключу
      </Button>
      <Text color="hint" variant="caption-2">
        Каждый вход по ключу сразу приходит владельцу в Telegram.
      </Text>
    </form>
  );
}
