import type { LabExecutor } from '../../store/api';

/** Where a Lab run is executed — a choice from a list; the task itself stays free text. */
export const EXECUTOR_OPTIONS: { value: LabExecutor; content: string }[] = [
  { value: 'any', content: 'Любой worker' },
  { value: 'fusion', content: 'Fusion 360 на Mac' },
];

export const executorLabel = (executor: LabExecutor | undefined): string | null => (executor === 'fusion' ? 'Fusion 360' : null);

export const EXECUTOR_HINT =
  '«Fusion 360 на Mac» берёт только worker, у которого в настройках включено «Fusion 360 на этом компьютере»: он работает рядом с открытым Fusion и может строить и проверять CAD-модели.';
