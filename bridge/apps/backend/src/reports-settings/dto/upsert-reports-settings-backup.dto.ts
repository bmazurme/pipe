import { IsNotEmpty, IsString } from 'class-validator';

export class UpsertReportsSettingsBackupDto {
  @IsString()
  @IsNotEmpty()
  payload: string;
}
