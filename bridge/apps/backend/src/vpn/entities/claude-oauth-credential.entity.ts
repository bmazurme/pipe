import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// Singleton row (bridge talks to exactly one Claude account for the usage
// widget) holding Anthropic's OAuth credential state — refreshed and
// re-persisted in place as the access token expires, so the widget never
// depends on a long-lived static secret. See VpnService.getValidAccessToken.
@Entity({ name: 'claude_oauth_credentials' })
export class ClaudeOauthCredential extends BaseEntity {
  @Column({ type: 'text' })
  accessToken: string;

  // Rotates on every refresh — Anthropic's token endpoint issues a new one
  // each time and invalidates the old, so this always holds the latest.
  @Column({ type: 'text' })
  refreshToken: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
