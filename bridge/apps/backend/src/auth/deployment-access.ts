import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UsersService } from '../users/users.service';

/** Splits the raw EMAILS value; blank entries are dropped, so " , " is an empty list. */
export function parseAllowedEmails(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

const same = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/**
 * The single place that decides who may use this deployment: the EMAILS list
 * when it has any entry, otherwise anyone may sign in and the owner is the
 * first account.
 */
@Injectable()
export class DeploymentAccessService {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  private allowedEmails(): string[] {
    return parseAllowedEmails(this.configService.get<string>('EMAILS'));
  }

  isAllowedToSignIn(email: string): boolean {
    const allowed = this.allowedEmails();

    return allowed.length === 0 || allowed.some((e) => same(e, email));
  }

  async isOwner(userId: number): Promise<boolean> {
    const allowed = this.allowedEmails();

    if (allowed.length > 0) {
      const user = await this.usersService.findById(userId);

      return !!user && allowed.some((e) => same(e, user.email));
    }

    const owner = await this.usersService.findOwner();

    return !!owner && owner.id === userId;
  }
}
