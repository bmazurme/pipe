export class EmergencyKeyStatusResponseDto {
  exists: boolean;
  prefix: string | null;
  createdAt: Date | null;
  lastUsedAt: Date | null;
}

// Carries the plaintext token — returned once, when the key is created or replaced.
export class CreatedEmergencyKeyResponseDto {
  prefix: string;
  token: string;
  createdAt: Date;
}
