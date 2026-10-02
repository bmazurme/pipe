import { IsIP, IsNotEmpty, IsString } from 'class-validator';

export class ProvisionVpnServerDto {
  @IsIP()
  host: string;

  @IsString()
  @IsNotEmpty()
  sshUser: string;

  @IsString()
  @IsNotEmpty()
  sshPassword: string;
}
