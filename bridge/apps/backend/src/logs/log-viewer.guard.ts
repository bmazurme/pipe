import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UsersService } from '../users/users.service';

// Runs after JwtGuard. The log covers the whole system, so it is limited to
// the deployment owner: the EMAILS list when set, otherwise the first account.
@Injectable()
export class LogViewerGuard implements CanActivate {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number } }>();
    const userId = request.user?.id;

    if (userId === undefined) {
      throw new ForbiddenException();
    }

    const allowedEmails = (this.configService.get<string>('EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (allowedEmails.length > 0) {
      const user = await this.usersService.findById(userId);

      if (user && allowedEmails.includes(user.email)) {
        return true;
      }
    } else {
      const owner = await this.usersService.findOwner();

      if (owner && owner.id === userId) {
        return true;
      }
    }

    throw new ForbiddenException('Logs are limited to the deployment owner');
  }
}
