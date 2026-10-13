import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { AppLogService } from './app-log.service';
import { AppLog } from './entities/app-log.entity';
import { LogViewerGuard } from './log-viewer.guard';
import { LogsController } from './logs.controller';
import { RequestLogInterceptor } from './request-log.interceptor';

// Global so any feature can inject AppLogService to record an event without
// importing this module (and so instrumentation never creates import cycles).
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AppLog]), UsersModule],
  controllers: [LogsController],
  providers: [
    AppLogService,
    LogViewerGuard,
    { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
  ],
  exports: [AppLogService],
})
export class LogsModule {}
