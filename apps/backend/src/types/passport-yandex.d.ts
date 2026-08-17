declare module 'passport-yandex' {
  import { Request } from 'express';

  export interface Profile {
    provider: string;
    id: string;
    displayName: string;
    _json: {
      default_email: string;
      [key: string]: unknown;
    };
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    passReqToCallback?: false;
  }

  export type VerifyCallback = (err: any, user?: any, info?: any) => void;

  export class Strategy {
    constructor(
      options: StrategyOptions,
      verify: (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
      ) => void,
    );
    name: string;
    authenticate(req: Request, options?: object): void;
  }
}
