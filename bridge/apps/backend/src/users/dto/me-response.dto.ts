export class MeResponseDto {
  id: number;
  username: string;
  status: string;

  static fromUser(user: {
    id: number;
    email: string;
    status: string;
  }): MeResponseDto {
    return {
      id: user.id,
      username: user.email,
      status: user.status,
    };
  }
}
