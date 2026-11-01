import type { LabExecutor } from '../../store/api';

/** Where a Lab run is executed — a choice from a list; the task itself stays free text. */
export const EXECUTOR_OPTIONS: { value: LabExecutor; content: string }[] = [
  { value: 'any', content: 'Любой worker' },
  { value: 'fusion', content: 'Fusion 360 на Mac' },
];

export const executorLabel = (executor: LabExecutor | undefined): string | null => (executor === 'fusion' ? 'Fusion 360' : null);

export const EXECUTOR_HINT =
  '«Fusion 360 на Mac» берёт только worker, у которого в настройках включено «Fusion 360 на этом компьютере»: он работает рядом с открытым Fusion и может строить и проверять CAD-модели.';

// 'auto' stays: the router keeps Fusion on a Claude model itself.
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'auto'];

/** Fusion is driven from the model's shell, which only Claude has: what the model picker offers for the executor, and the model to fall back to. */
export const modelsFor = <T extends { value: string }>(options: T[], executor: LabExecutor | undefined): T[] =>
  executor === 'fusion' ? options.filter((option) => CLAUDE_MODELS.includes(option.value)) : options;

export const modelAfterExecutor = (model: string, executor: LabExecutor): string =>
  executor === 'fusion' && !CLAUDE_MODELS.includes(model) ? 'sonnet' : model;
