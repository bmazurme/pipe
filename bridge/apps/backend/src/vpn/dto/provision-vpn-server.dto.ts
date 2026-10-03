import { Equals, IsIP, IsNotEmpty, IsString } from 'class-validator';

export class ProvisionVpnServerDto {
  @IsIP()
  host: string;

  @IsString()
  @IsNotEmpty()
  sshUser: string;

  @IsString()
  @IsNotEmpty()
  sshPassword: string;

  // See ConfirmActionDto's own comment — same "are you sure" gate.
  @Equals(true)
  confirm: boolean;
}
