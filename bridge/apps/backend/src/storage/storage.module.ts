import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { UPLOAD_DIR } from './config/multer.config';
import { StoredFile } from './entities/stored-file.entity';
import { createFileStore } from './file-store/create-file-store';
import { FILE_STORE } from './file-store/file-store';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([StoredFile])],
  controllers: [StorageController],
  providers: [
    // STORAGE_DRIVER=local (default) | s3 — see file-store/create-file-store.ts
    {
      provide: FILE_STORE,
      useFactory: () => createFileStore(process.env, UPLOAD_DIR),
    },
    StorageService,
  ],
  exports: [StorageService, FILE_STORE],
})
export class StorageModule {}
