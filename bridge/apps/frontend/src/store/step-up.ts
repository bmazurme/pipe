// The second factor for dangerous actions (S6). The backend answers 403 {code: 'STEP_UP_REQUIRED'}; the app asks for a
// code once, trades it for a five-minute grant and sends that as `X-Step-Up` until it runs out.
//
// The grant lives in memory only, on purpose: a reload (or a stolen laptop's disk) holds nothing that unlocks Secrets.

interface Grant {
  token: string;
  expiresAt: number;
}

// A grant that has under this long to live is not worth sending: it would expire on the way.
const SAFETY_MARGIN_MS = 5_000;

let grant: Grant | null = null;

export function storeStepUpGrant(token: string, expiresAt: string): void {
  grant = { token, expiresAt: new Date(expiresAt).getTime() };
}

export function clearStepUpGrant(): void {
  grant = null;
}

export function currentStepUpGrant(now = Date.now()): string | null {
  if (!grant) return null;

  if (grant.expiresAt - SAFETY_MARGIN_MS <= now) {
    grant = null;

    return null;
  }

  return grant.token;
}

// The dialog registers itself here; the store cannot import a component. Resolves true once a grant is stored,
// false when the person gives up.
type Prompt = () => Promise<boolean>;

let prompt: Prompt | null = null;
let inFlight: Promise<boolean> | null = null;

export function setStepUpPrompt(next: Prompt | null): void {
  prompt = next;
}

// One dialog at a time: five requests that each need a code share the one question and all retry on its answer.
export function requestStepUp(): Promise<boolean> {
  if (!prompt) return Promise.resolve(false);

  if (!inFlight) {
    inFlight = prompt().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}

export function isStepUpRequired(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const { status, data } = error as { status?: unknown; data?: unknown };

  return (
    status === 403 &&
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === 'STEP_UP_REQUIRED'
  );
}
