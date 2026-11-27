// S3 — how risky a pull request that a run opened is, from the paths it touches. The label (`risk:low|medium|high`) goes on the pull request, into
// the message that offers the merge, and is what the board's autodeploy reads to hold a risky bot change back for a while before it goes live
// (infra/autodeploy: SOAK_MINUTES) — so a bad one has half an hour in which somebody can notice it and revert, and a typo in the docs does not wait.
//
// Table-driven and conservative: a path no rule knows is `medium`, never `low`. A run opens its pull requests only from paths the loop may touch
// (protected-paths.ts drops the rest), so `high` here is «the part of the repository that, if wrong, takes the system or its data down».

export type PrRisk = 'low' | 'medium' | 'high';

export const RISK_LABELS: Record<PrRisk, string> = {
  low: 'risk:low',
  medium: 'risk:medium',
  high: 'risk:high',
};

const RANK: Record<PrRisk, number> = { low: 0, medium: 1, high: 2 };

interface Rule {
  risk: PrRisk;
  /** Why — shown to the owner next to the label. */
  why: string;
  test: RegExp;
}

// First match wins, so the order is the order of precedence: tests and docs first (a test of an auth module is still only a test).
const RULES: Rule[] = [
  {
    risk: 'low',
    why: 'тесты',
    test: /(\.(spec|test)\.(ts|tsx|js|mjs)$|(^|\/)(__tests__|test|tests)\/)/,
  },
  { risk: 'low', why: 'документация', test: /(\.md$|^docs\/|^LICENSE$)/ },

  // The things that take the system or its data down, or hand it to someone.
  { risk: 'high', why: 'инфраструктура', test: /^infra\// },
  { risk: 'high', why: 'worker (образ, песочница)', test: /^worker\// },
  { risk: 'high', why: 'миграции БД', test: /(^|\/)migrations\// },
  {
    risk: 'high',
    why: 'аутентификация, секреты, VPN, платы',
    test: /^bridge\/apps\/backend\/src\/(auth|oauth|secrets|crypto|users|vpn|tunnel|boards|telegram|loop)\//,
  },
  {
    risk: 'high',
    why: 'шифрование и проверка утечек',
    test: /^packages\/protocol\/src\/(encryption|encryption-browser|leakScan)/,
  },
  {
    risk: 'high',
    why: 'сборка и выкат',
    test: /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml)$|^bridge\/deploy\/|^scripts\/|\.sh$|^\.github\//,
  },

  // Code that runs in production, but whose failure the next release or a revert undoes.
  { risk: 'medium', why: 'зависимости', test: /(^|\/)package\.json$/ },
  {
    risk: 'low',
    why: 'оформление интерфейса',
    test: /^bridge\/apps\/frontend\/src\/.*\.css$/,
  },
  {
    risk: 'low',
    why: 'тексты и интерфейс',
    test: /^bridge\/apps\/frontend\/src\/pages\/[^/]+\/[^/]+\.tsx$/,
  },
];

export interface RiskAssessment {
  risk: PrRisk;
  /** The files that decided it (those of the highest risk), with why. */
  reasons: Array<{ file: string; why: string }>;
}

export function riskOf(path: string): { risk: PrRisk; why: string } {
  const rule = RULES.find((candidate) => candidate.test.test(path));

  // Unknown = medium: «I do not know this path» must never read as «harmless».
  return rule
    ? { risk: rule.risk, why: rule.why }
    : { risk: 'medium', why: 'код' };
}

export function assessRisk(paths: string[]): RiskAssessment {
  if (paths.length === 0) return { risk: 'low', reasons: [] };

  const rated = paths.map((path) => ({ file: path, ...riskOf(path) }));
  const risk = rated.reduce<PrRisk>(
    (worst, item) => (RANK[item.risk] > RANK[worst] ? item.risk : worst),
    'low',
  );

  return {
    risk,
    reasons: rated
      .filter((item) => item.risk === risk)
      .slice(0, 5)
      .map(({ file, why }) => ({ file, why })),
  };
}

const RISK_WORD: Record<PrRisk, string> = {
  low: 'низкий',
  medium: 'средний',
  high: 'высокий',
};

// One line for the pull request's description and the Telegram message.
export function describeRisk(assessment: RiskAssessment): string {
  const why = [...new Set(assessment.reasons.map((reason) => reason.why))].join(
    ', ',
  );

  return `Риск: ${RISK_WORD[assessment.risk]}${why ? ` (${why})` : ''}`;
}
