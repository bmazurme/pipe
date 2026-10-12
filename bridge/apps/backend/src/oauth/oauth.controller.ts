import {
  BadRequestException,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AUTH_PROVIDERS,
  AuthProvider,
} from '../auth/entities/auth-identity.entity';
import { JwtGuard } from '../auth/guards/jwt.guard';
import {
  LINK_NONCE_COOKIE,
  OauthLinkStateService,
} from './oauth-link-state.service';
import { OauthProfile } from './oauth-profile';
import { OauthService } from './oauth.service';
import { GithubStartGuard, YandexStartGuard } from './oauth-start.guards';

type CallbackRequest = Request & { user: { profile: OauthProfile } };

// Which provider has credentials configured — the login page hides the
// others, so a provider that was never set up on this deployment is not offered.
const CREDENTIAL_ENV: Record<AuthProvider, string> = {
  yandex: 'YANDEX_ID',
  github: 'GITHUB_ID',
};

// Human-initiated login, never polled — same reasoning as AuthController's
// own stricter throttle.
@Controller('api/v1/oauth')
@UseInterceptors(ClassSerializerInterceptor)
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class OauthController {
  constructor(
    private readonly oauthService: OauthService,
    private readonly linkState: OauthLinkStateService,
    private readonly configService: ConfigService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'Sign-in providers configured on this deployment' })
  providers(): { providers: AuthProvider[] } {
    return {
      providers: AUTH_PROVIDERS.filter((provider) =>
        Boolean(this.configService.get<string>(CREDENTIAL_ENV[provider])),
      ),
    };
  }

  // Starts "connect another sign-in method": an authenticated call that
  // returns the state to put on the provider redirect (and sets the matching
  // nonce cookie). The browser then navigates to GET /oauth/:provider?state=…
  @UseGuards(JwtGuard)
  @Post(':provider/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start connecting a sign-in method to this account',
  })
  startLink(
    @Param('provider') provider: string,
    @CurrentUser() currentUser: { id: number },
    @Res({ passthrough: true }) response: Response,
  ): { state: string } {
    const known = this.parseProvider(provider);
    const { state, nonce } = this.linkState.create(currentUser.id, known);

    response.cookie(LINK_NONCE_COOKIE, nonce, this.linkState.cookieOptions());

    return { state };
  }

  @Get('yandex')
  @UseGuards(YandexStartGuard)
  async yandexLogin(): Promise<void> {
    // handled by passport-yandex, redirects to Yandex's consent screen
  }

  @Get('yandex/redirect')
  @UseGuards(AuthGuard('yandex'))
  async yandexLoginRedirect(
    @Req() req: CallbackRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    return this.complete(req, response);
  }

  @Get('github')
  @UseGuards(GithubStartGuard)
  async githubLogin(): Promise<void> {
    // handled by passport-github2, redirects to GitHub's consent screen
  }

  @Get('github/redirect')
  @UseGuards(AuthGuard('github'))
  async githubLoginRedirect(
    @Req() req: CallbackRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    return this.complete(req, response);
  }

  private parseProvider(provider: string): AuthProvider {
    if (!(AUTH_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException('Неизвестный провайдер');
    }
    return provider as AuthProvider;
  }

  // A callback carrying a state is the tail of a "connect" flow and never
  // signs anyone in; one without it is an ordinary login.
  private async complete(
    req: CallbackRequest,
    response: Response,
  ): Promise<void> {
    const { profile } = req.user;
    const state =
      typeof req.query.state === 'string' ? req.query.state : undefined;

    if (state) {
      const nonce = (req.cookies as Record<string, string> | undefined)?.[
        LINK_NONCE_COOKIE
      ];
      const userId = this.linkState.verify(state, nonce, profile.provider);

      response.clearCookie(LINK_NONCE_COOKIE, this.linkState.clearOptions());

      if (userId === null) {
        throw new BadRequestException(
          'Ссылка для подключения устарела или недействительна — начните заново',
        );
      }

      return this.oauthService.link(userId, profile, response);
    }

    return this.oauthService.signin(
      profile,
      response,
      req.headers['user-agent'] ?? null,
      req.ip ?? null,
    );
  }
}
