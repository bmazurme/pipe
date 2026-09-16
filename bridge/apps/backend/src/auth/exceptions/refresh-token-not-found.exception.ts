import { HttpException, HttpStatus } from '@nestjs/common';

export class RefreshTokenNotFoundException extends HttpException {
  constructor() {
    super('Refresh token not found in cookies', HttpStatus.UNAUTHORIZED);
  }
}
