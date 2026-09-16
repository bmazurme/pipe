import { AuthGuard } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

/**
 * Like JwtGuard, but never rejects the request when the token is missing/invalid —
 * request.user is simply left unset. Useful for public endpoints that behave
 * differently for authenticated visitors without requiring auth.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    return user;
  }
}
