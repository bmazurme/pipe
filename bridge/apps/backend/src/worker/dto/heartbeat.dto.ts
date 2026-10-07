import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class HeartbeatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  workerName: string;
}
