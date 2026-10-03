import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateVpnConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsNotEmpty()
  panelUrl: string;

  @IsString()
  @IsNotEmpty()
  panelApiToken: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  serverAddress: string;
}
