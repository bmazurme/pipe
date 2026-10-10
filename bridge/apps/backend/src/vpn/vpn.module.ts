import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { VpnConnection } from './entities/vpn-connection.entity';
import { GithubActionsService } from './github-actions.service';
import { VpnConnectionsController } from './vpn-connections.controller';
import { VpnConnectionsService } from './vpn-connections.service';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([VpnConnection])],
  controllers: [VpnController, VpnConnectionsController],
  providers: [VpnService, VpnConnectionsService, GithubActionsService],
})
export class VpnModule {}
