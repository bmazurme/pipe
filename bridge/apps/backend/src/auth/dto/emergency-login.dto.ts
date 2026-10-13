import { IsString, Length } from 'class-validator';

export class EmergencyLoginDto {
  @IsString()
  @Length(20, 200)
  key: string;
}
