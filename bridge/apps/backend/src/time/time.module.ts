import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DayOff } from './entities/day-off.entity';
import { TimeReportEntry } from './entities/time-report-entry.entity';
import { TimeExportController } from './time-export.controller';
import { TimeImportController } from './time-import.controller';
import { TimeController } from './time.controller';
import { TimeService } from './time.service';

@Module({
  imports: [TypeOrmModule.forFeature([DayOff, TimeReportEntry])],
  controllers: [TimeController, TimeExportController, TimeImportController],
  providers: [TimeService],
})
export class TimeModule {}
