import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [AuthModule],
  controllers: [VpnController],
  providers: [VpnService],
})
export class VpnModule {}
