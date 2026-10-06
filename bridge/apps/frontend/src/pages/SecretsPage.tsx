import { PageHeader } from '../widgets/PageHeader';
import { AddSecretForm } from './secrets/AddSecretForm';
import { SecretListCard } from './secrets/SecretListCard';
import styles from './SecretsPage.module.css';

export function SecretsPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Secrets"
        description="Личное хранилище секретов — пары «имя — значение», зашифрованные на сервере."
      />

      <AddSecretForm />
      <SecretListCard />
    </div>
  );
}
