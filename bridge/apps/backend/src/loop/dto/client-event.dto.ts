import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Structured on purpose (no free-text message): an API key is a machine
// credential, and letting it push arbitrary text to the owner's Telegram
// would make a leaked key a spam/phishing channel.
export const CLIENT_EVENT_TYPES = [
  'pulled',
  'pull_failed',
  'issues_created',
] as const;

export class ClientEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsIn(CLIENT_EVENT_TYPES)
  type: (typeof CLIENT_EVENT_TYPES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  taskKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  error?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  count?: number;
}
