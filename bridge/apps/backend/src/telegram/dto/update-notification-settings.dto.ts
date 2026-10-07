import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdateNotificationSettingsDto {
  // "23:00-08:00", or "off".
  @IsString()
  @Matches(/^(off|\d{1,2}:\d{2}-\d{1,2}:\d{2})$/i, {
    message: 'quietHours must look like "23:00-08:00" or "off"',
  })
  quietHours: string;

  @IsString()
  @MaxLength(64)
  timezone: string;
}
