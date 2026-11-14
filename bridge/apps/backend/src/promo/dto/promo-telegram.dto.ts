import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

import {
  TELEGRAM_ROLES,
  type TelegramRole,
} from '../entities/promo-telegram-target.entity';

export class TelegramRoleParam {
  @IsIn(TELEGRAM_ROLES)
  role: TelegramRole;
}

export class BindTargetDto {
  // A numeric chat id, @name or t.me/name.
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  chat: string;
}
