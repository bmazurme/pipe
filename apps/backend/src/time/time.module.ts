import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DayOff } from './entities/day-off.entity';
import { TimeController } from './time.controller';
import { TimeService } from './time.service';

@Module({
  imports: [TypeOrmModule.forFeature([DayOff])],
  controllers: [TimeController],
  providers: [TimeService],
})
export class TimeModule {}
