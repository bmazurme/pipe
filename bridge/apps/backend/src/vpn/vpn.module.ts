import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { ClaudeOauthCredential } from './entities/claude-oauth-credential.entity';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([ClaudeOauthCredential])],
  controllers: [VpnController],
  providers: [VpnService],
})
export class VpnModule {}
