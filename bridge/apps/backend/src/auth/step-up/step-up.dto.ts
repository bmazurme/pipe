import { IsString, Length } from 'class-validator';

// Either a 6-digit authenticator code or a recovery code (xxxx-xxxx-xxxx-xxxx), so one field serves both.
export class StepUpCodeDto {
  @IsString()
  @Length(6, 40)
  code: string;
}

export class StepUpStatusResponseDto {
  enabled: boolean;
  // A setup was started and never confirmed with a first code.
  setupPending: boolean;
  recoveryCodesLeft: number;
  // STEP_UP_ENFORCE=true: an action that needs a second factor is refused while none is set up.
  enforced: boolean;
}

export class StepUpSetupResponseDto {
  secret: string;
  otpauthUri: string;
}

export class StepUpRecoveryCodesResponseDto {
  recoveryCodes: string[];
}

export class StepUpGrantResponseDto {
  token: string;
  expiresAt: string;
}
