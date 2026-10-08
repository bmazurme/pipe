import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ContextController } from './context.controller';
import { ContextService } from './context.service';
import { Context } from './entities/context.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Context])],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
