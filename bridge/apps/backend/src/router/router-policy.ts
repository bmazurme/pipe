// The model router's decision, as pure functions: given a task, where it runs, what the classifier said about its size and the owner's
// settings, which model does it go to, and why. The owner reads the "why" on the run, so it is written for them.
//
// The classifier is the one measured in scripts/router-eval (ROUTER-L0-RESULT.md): from the task text alone it puts a task in a size tier
// 1–4 (right to within one tier 98 % of the time on 40 past tasks) and says whether the change has to produce a generated file or a
// migration, which a model that only reads and writes files cannot do.
import { isClaudeModelName } from '../improve/improve-shared';

export const AUTO_MODEL = 'auto';

export const TIERS = [1, 2, 3, 4] as const;
export type Tier = (typeof TIERS)[number];

export interface Classification {
  tier: Tier;
  needsGenerated: boolean;
}

// A task that mentions any of the keywords goes to this model, whatever its size ("строго заданные модели").
export interface RouterRule {
  name: string;
  // Words or phrases, one per line or separated by commas; matched case-insensitively anywhere in the task.
  keywords: string;
  model: string;
  enabled: boolean;
}

export interface RouterSettings {
  // The model for each size tier: a Claude model, a named provider, or "custom:<key id>".
  tierModels: Record<Tier, string>;
  rules: RouterRule[];
}

// Haiku for everything up to tier 3: replayed on 32 past tasks of those tiers with the real pull requests' tests, Haiku and Sonnet passed exactly
// the same ones (21 of 32 each) — tier by tier, task by task — and Sonnet cost 11 times as much (ROUTER-L0-RESULT.md). Tier 4 is the strongest model:
// there were only 2 such tasks, no data. Nothing here is a local model: measured on the owner's own Mac, those did not pass the tests of even
// the smallest tasks, so they are for the owner to put in by hand.
export const DEFAULT_TIER_MODELS: Record<Tier, string> = {
  1: 'haiku',
  2: 'haiku',
  3: 'haiku',
  4: 'opus',
};

export const DEFAULT_SETTINGS: RouterSettings = {
  tierModels: DEFAULT_TIER_MODELS,
  rules: [],
};

// What a task with no usable classification, or nothing better, runs on.
export const FALLBACK_MODEL = 'sonnet';

export type RoutingSource = 'rule' | 'classifier' | 'fallback' | 'executor';

export interface Routing {
  model: string;
  source: RoutingSource;
  reason: string;
  tier?: Tier;
  needsGenerated?: boolean;
  rule?: string;
}

export function keywordsOf(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== '');
}

// The first enabled rule one of whose keywords occurs in the task.
export function matchRule(
  task: string,
  rules: RouterRule[],
): RouterRule | null {
  const text = task.toLowerCase();

  return (
    rules.find(
      (rule) =>
        rule.enabled &&
        keywordsOf(rule.keywords).some((word) => text.includes(word)),
    ) ?? null
  );
}

export interface RouteInput {
  task: string;
  // 'fusion' drives Fusion 360 from the model's shell: only Claude has one.
  executor: 'any' | 'fusion';
  // null: the classifier did not answer (no worker to ask, an unparsable answer).
  classification: Classification | null;
  settings: RouterSettings;
}

const modelName = (model: string) =>
  model.startsWith('custom:') ? 'своя модель' : model;

export function chooseRoute({
  task,
  executor,
  classification,
  settings,
}: RouteInput): Routing {
  const needsShell = executor === 'fusion';

  // A model that can run a shell is Claude; for the work that needs one, a fixed model that cannot is replaced, and the owner is told.
  const withShell = (
    model: string,
    why: string,
  ): { model: string; note: string } =>
    needsShell && !isClaudeModelName(model)
      ? {
          model: FALLBACK_MODEL,
          note: ` (${modelName(model)} не умеет выполнять команды, а ${why} — взят ${FALLBACK_MODEL})`,
        }
      : { model, note: '' };

  const rule = matchRule(task, settings.rules);

  if (rule) {
    const { model, note } = withShell(
      rule.model,
      'Fusion 360 без оболочки не работает',
    );

    return {
      model,
      source: 'rule',
      rule: rule.name,
      reason: `Правило «${rule.name}»: задача упоминает ключевое слово — ${modelName(rule.model)}${note}`,
    };
  }

  if (!classification) {
    const { model, note } = withShell(FALLBACK_MODEL, '');

    return {
      model,
      source: 'fallback',
      reason: `Размер задачи определить не удалось (нет свободного worker с Claude или нечитаемый ответ) — ${model}${note}`,
    };
  }

  const { tier, needsGenerated } = classification;
  const wanted = settings.tierModels[tier] ?? FALLBACK_MODEL;
  // A model that only reads and writes files cannot regenerate openapi.json, a lockfile or a snapshot, nor write a migration.
  const shellOnly = needsShell || needsGenerated;
  const fits = !shellOnly || isClaudeModelName(wanted);
  const model = fits ? wanted : FALLBACK_MODEL;
  const why = needsShell
    ? 'Fusion 360 нужна оболочка'
    : 'нужны сгенерированные файлы или миграция';

  return {
    model,
    source: 'classifier',
    tier,
    needsGenerated,
    reason: `Ярус ${tier} из 4${needsGenerated ? ', нужны сгенерированные файлы' : ''} — ${modelName(model)}${fits ? '' : ` (вместо ${modelName(wanted)}: для этой задачи ${why})`}`,
  };
}

// What the owner may save: every tier has a model and every rule a name, keywords and model. Models are checked by the caller.
export function validateSettings(
  settings: RouterSettings,
  isKnownModel: (model: string) => boolean,
): string | null {
  for (const tier of TIERS) {
    if (!isKnownModel(settings.tierModels[tier]))
      return `Ярус ${tier}: неизвестная модель «${settings.tierModels[tier]}»`;
  }

  if (settings.rules.length > 20) return 'Правил не больше 20';

  for (const rule of settings.rules) {
    if (rule.name.trim() === '') return 'У правила нет названия';
    if (keywordsOf(rule.keywords).length === 0)
      return `У правила «${rule.name}» нет ключевых слов`;
    if (!isKnownModel(rule.model))
      return `Правило «${rule.name}»: неизвестная модель «${rule.model}»`;
  }

  return null;
}
