import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import { DeploymentAccessService } from '../auth/deployment-access';
import { AuthService } from '../auth/auth.service';
import { IdentitiesService } from '../auth/identities.service';
import { SessionsService } from '../auth/sessions.service';
import { UsersService } from '../users/users.service';
import { OauthProfile } from './oauth-profile';

// `?reason=` on /oauth-error: the page explains each one differently.
export type OauthFailure =
  'not-allowed' | 'disabled' | 'unverified' | 'conflict';

@Injectable()
export class OauthService {
  private readonly logger = new Logger(OauthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly identitiesService: IdentitiesService,
    private readonly authService: AuthService,
    private readonly sessionsService: SessionsService,
    private readonly configService: ConfigService,
    private readonly deploymentAccess: DeploymentAccessService,
  ) {}

  private getTargetUrl(): string {
    const targetUrl = this.configService.get<string>('BRIDGE_TARGET_URL');

    if (!targetUrl) {
      throw new Error('BRIDGE_TARGET_URL is not configured');
    }
    return targetUrl;
  }

  private fail(response: Response, reason: OauthFailure): void {
    const suffix = reason === 'not-allowed' ? '' : `?reason=${reason}`;

    return response.redirect(`${this.getTargetUrl()}/oauth-error${suffix}`);
  }

  /**
   * Looks the provider account up by its stable id first; only an account the
   * app has never seen falls back to the email — and then only a verified
   * email on the EMAILS list may attach to an existing user or create one.
   */
  async signin(
    profile: OauthProfile,
    response: Response,
    userAgent: string | null,
    ip: string | null,
  ): Promise<void> {
    const { provider, providerUserId, email } = profile;

    let identity = await this.identitiesService.findByProviderUserId(
      provider,
      providerUserId,
    );

    // Users that existed before identities were introduced carry
    // `legacy:<email>` until their first sign-in tells us the real id.
    if (!identity && provider === 'yandex' && email) {
      identity = await this.identitiesService.findLegacy(provider, email);
    }

    let userId: number;

    if (identity) {
      if (!identity.enabled) {
        this.logger.warn(
          `Blocked sign-in through disabled ${provider} for user ${identity.userId}`,
        );
        return this.fail(response, 'disabled');
      }
      await this.identitiesService.markUsed(identity, providerUserId, email);
      userId = identity.userId;
    } else {
      if (!email || !profile.emailVerified) {
        this.logger.warn(
          `Blocked ${provider} sign-in without a verified email`,
        );
        return this.fail(response, 'unverified');
      }
      if (!this.deploymentAccess.isAllowedToSignIn(email)) {
        this.logger.warn(
          `Blocked OAuth attempt for unregistered email: ${email}`,
        );
        return this.fail(response, 'not-allowed');
      }

      const existing = await this.usersService.findByEmail(email);

      if (existing) {
        if (
          await this.identitiesService.findByUserAndProvider(
            existing.id,
            provider,
          )
        ) {
          // The user already has another ${provider} account linked; a
          // different one sharing the email must be linked on purpose.
          return this.fail(response, 'conflict');
        }
        userId = existing.id;
      } else {
        userId = (await this.usersService.create({ email })).id;
      }

      await this.identitiesService.create(
        userId,
        provider,
        providerUserId,
        email,
      );
    }

    await this.startSession(userId, response, userAgent, ip);
    response.redirect(this.getTargetUrl());
  }

  /** The signed-in user connects another sign-in method; sends the browser back to the profile. */
  async link(
    userId: number,
    profile: OauthProfile,
    response: Response,
  ): Promise<void> {
    const target = `${this.getTargetUrl()}/profile?tab=access`;

    try {
      await this.identitiesService.link(
        userId,
        profile.provider,
        profile.providerUserId,
        profile.email,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        const message = encodeURIComponent(error.message);

        return response.redirect(`${target}&linkError=${message}`);
      }
      throw error;
    }

    response.redirect(`${target}&linked=${profile.provider}`);
  }

  private async startSession(
    userId: number,
    response: Response,
    userAgent: string | null,
    ip: string | null,
  ): Promise<void> {
    const session = await this.sessionsService.createSession(
      userId,
      userAgent,
      ip,
    );
    const { refreshToken } = await this.authService.generateNewTokens(
      userId,
      session.id,
    );

    await this.sessionsService.attachRefreshToken(session.id, refreshToken);
    this.authService.setRefreshCookie(response, refreshToken);
  }
}
