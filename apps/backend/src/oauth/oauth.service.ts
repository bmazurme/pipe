import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../auth/sessions.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class OauthService {
  private readonly logger = new Logger(OauthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly sessionsService: SessionsService,
    private readonly configService: ConfigService,
  ) {}

  private getTargetUrl(): string {
    const targetUrl = this.configService.get<string>('NOTES_TARGET_URL');

    if (!targetUrl) {
      throw new Error('NOTES_TARGET_URL is not configured');
    }
    return targetUrl;
  }

  async signinOrSignup(
    { email }: { email: string },
    response: Response,
    userAgent: string | null,
    ip: string | null,
  ): Promise<void> {
    const allowedEmails = this.configService.get<string>('EMAILS');
    if (allowedEmails) {
      const list = allowedEmails
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

      if (!list.includes(email)) {
        this.logger.warn(
          `Blocked OAuth attempt for unregistered email: ${email}`,
        );
        return response.redirect(`${this.getTargetUrl()}/oauth-error`);
      }
    }

    let currentUser: User | null = await this.usersService.findByEmail(email);

    if (!currentUser) {
      await this.usersService.create({ email });
      currentUser = await this.usersService.findByEmail(email);
    }

    if (!currentUser) {
      this.logger.error(`Failed to create user with email: ${email}`);
      throw new Error(`Failed to create user with email: ${email}`);
    }

    const session = await this.sessionsService.createSession(
      currentUser.id,
      userAgent,
      ip,
    );

    const { refreshToken } = await this.authService.generateNewTokens(
      currentUser.id,
      session.id,
    );

    await this.sessionsService.attachRefreshToken(session.id, refreshToken);

    this.authService.setRefreshCookie(response, refreshToken);

    response.redirect(this.getTargetUrl());
  }
}
