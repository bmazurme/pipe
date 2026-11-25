import { PageHeader } from '../../widgets/PageHeader';
import { AddSecretForm } from './AddSecretForm';
import { ExportEnvButton } from './ExportEnvButton';
import { ImportEnvButton } from './ImportEnvButton';
import { SecretListCard } from './SecretListCard';
import styles from './SecretsPage.module.css';

export function SecretsPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Secrets"
        description="Личное хранилище секретов — пары «имя — значение», зашифрованные на сервере."
      />

      <AddSecretForm />
      <ImportEnvButton />
      <ExportEnvButton />
      <SecretListCard />
    </div>
  );
}
