import { Equals } from 'class-validator';

// A plain "are you sure" gate for the GitHub-credential-wielding endpoints
// on this controller (sync/setWorkerSecret/provision) — doesn't stop a
// truly compromised backend process (see IMPROVEMENTS_TECH.md 1.4's own
// framing: the real fix there is moving these out of bridge's backend
// entirely), but does mean a stray/automated/replayed request without a
// deliberately-constructed body can't trigger one of these by accident.
export class ConfirmActionDto {
  @Equals(true)
  confirm: boolean;
}
