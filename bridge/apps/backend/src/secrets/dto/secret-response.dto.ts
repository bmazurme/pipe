import { Secret } from '../entities/secret.entity';

// Never carries the value — a listing exists to tell secrets apart,
// edit their name/description and delete them, not to redisplay the
// stored value in bulk. See SecretsController's own reveal() for the one
// endpoint that does return it, deliberately separate from this one.
export class SecretResponseDto {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(secret: Secret): SecretResponseDto {
    return {
      id: secret.id,
      name: secret.name,
      description: secret.description,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    };
  }
}
