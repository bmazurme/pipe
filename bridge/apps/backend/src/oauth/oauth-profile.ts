import { AuthProvider } from '../auth/entities/auth-identity.entity';

/** What every provider strategy hands to OauthService, whatever the provider's own profile looks like. */
export interface OauthProfile {
  provider: AuthProvider;
  /** The provider's stable account id — never the email. */
  providerUserId: string;
  email: string | null;
  /** Only a verified email may match an existing user or pass the EMAILS allowlist. */
  emailVerified: boolean;
}
