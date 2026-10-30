import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { InboxItem } from './inbox';
import { InboxService } from './inbox.service';

// Browser session only: this is the owner's own to-do list, never read by sync/reports/worker.
@Controller('api/v1/inbox')
@UseGuards(JwtGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  async list(@CurrentUser() user: { id: number }): Promise<InboxItem[]> {
    return this.inbox.list(user.id);
  }
}
