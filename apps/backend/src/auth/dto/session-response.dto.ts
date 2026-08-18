import { Session } from '../entities/session.entity';

export class SessionResponseDto {
  id: number;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  isCurrent: boolean;

  static fromSession(
    session: Session,
    currentSessionId: number,
  ): SessionResponseDto {
    return {
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      isCurrent: session.id === currentSessionId,
    };
  }
}
