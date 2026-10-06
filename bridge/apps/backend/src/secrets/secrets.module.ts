import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Secret } from './entities/secret.entity';
import { SecretsController } from './secrets.controller';
import { SecretsService } from './secrets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Secret])],
  controllers: [SecretsController],
  providers: [SecretsService],
})
export class SecretsModule {}
