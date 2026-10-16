import { Card, Label, Text } from '@gravity-ui/uikit';

import { PageHeader } from '../widgets/PageHeader';
import styles from './LabPage.module.css';

// Lab has no backend of its own yet — it's a standalone Python CLI (build123d-based
// parametric CAD + calc + BOM), run and read outside bridge entirely. This page is
// the sidebar stub for it: what it is and where it stands, not a live view of
// anything — there is nothing bridge can fetch yet. See Lab/README.md and
// Lab/IMPLEMENTATION_PLAN.md in the repo for the real detail and the integration
// plan (a bridge "Hardware" module, a CAD-capable worker image) this stub stands in
// for.
const DOMAINS: { title: string; description: string }[] = [
  {
    title: 'Катер (boat)',
    description: 'Параметрический корпус (лофт по сечениям), гидростатика (закон Архимеда), оценка скорости по мощности/весу.',
  },
  {
    title: 'Самолёт (aircraft)',
    description: 'Параметрическое крыло (плейсхолдер вместо профиля), нагрузка на крыло — проверяет, что переход между доменами не трогает общее ядро.',
  },
];

const NEXT_PHASES: string[] = [
  'Точность расчётов: настоящий слайсер вместо константы, метод Savitsky вместо грубой формулы, профиль крыла вместо пластины',
  'Прочность — сетка (gmsh) + решатель (CalculiX)',
  'Модуль bridge для хранения и сравнения результатов (predicted/measured) по итерациям',
  'CAD-окружение в образе worker — автоматический прогон расчётов агентом',
];

export function LabPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Lab"
        description="CAD, расчёты и BOM для хардварных проектов — от характеристик до оптимизации по цене."
      />

      <Card view="outlined" className={styles.card}>
        <div className={styles.statusRow}>
          <Label theme="info" size="m">
            MVP
          </Label>
          <Text variant="subheader-2">Пока отдельный CLI, без страницы с живыми данными</Text>
        </div>
        <Text variant="body-2" color="secondary">
          Модульное ядро (геометрия/материалы/BOM/печать общие для всех классов изделий) плюс
          домены-плагины на каждый класс изделия. Запускается и читается вне bridge —
          эта страница только показывает, что есть и что дальше, фетчить тут пока нечего.
        </Text>
      </Card>

      <Card view="outlined" className={styles.card}>
        <Text variant="subheader-2">Домены сейчас</Text>
        <ul className={styles.list}>
          {DOMAINS.map((domain) => (
            <li key={domain.title} className={styles.listItem}>
              <Text variant="body-2">{domain.title}</Text>
              <Text variant="caption-2" color="secondary">
                {domain.description}
              </Text>
            </li>
          ))}
        </ul>
      </Card>

      <Card view="outlined" className={styles.card}>
        <Text variant="subheader-2">Дальше по плану</Text>
        <ul className={styles.list}>
          {NEXT_PHASES.map((phase) => (
            <li key={phase} className={styles.listItem}>
              <Text variant="caption-2" color="secondary">
                {phase}
              </Text>
            </li>
          ))}
        </ul>
      </Card>

      <Text variant="caption-2" color="hint">
        Подробности и результаты демо-проектов: <code className={styles.path}>Lab/README.md</code> и{' '}
        <code className={styles.path}>Lab/IMPLEMENTATION_PLAN.md</code> в репозитории.
      </Text>
    </div>
  );
}
