import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { DeploymentAccessService } from '../deployment-access';

// Runs after JwtGuard. Limits a route to the deployment owner: the EMAILS list
// when set, otherwise the first account.
@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(private readonly access: DeploymentAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id?: number } }>();
    const userId = request.user?.id;

    if (userId === undefined) {
      throw new ForbiddenException();
    }

    if (await this.access.isOwner(userId)) {
      return true;
    }

    throw new ForbiddenException('Limited to the deployment owner');
  }
}
