import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeploymentAccessService } from '../auth/deployment-access';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  // DeploymentAccessService needs only UsersService and the global config;
  // provided here as well because AuthModule already imports this module.
  providers: [UsersService, DeploymentAccessService],
  exports: [UsersService],
})
export class UsersModule {}
