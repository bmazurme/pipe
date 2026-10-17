export class MeResponseDto {
  id: number;
  username: string;
  status: string;
  /** Whether the owner-only routes (OwnerGuard) are open to this account. */
  isOwner: boolean;

  static fromUser(
    user: {
      id: number;
      email: string;
      status: string;
    },
    isOwner: boolean,
  ): MeResponseDto {
    return {
      id: user.id,
      username: user.email,
      status: user.status,
      isOwner,
    };
  }
}
