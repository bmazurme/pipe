import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';

import { UPLOAD_DIR } from '../../storage/config/multer.config';
import { isAllowedAttachment, MAX_ATTACHMENT_BYTES } from '../attachments';

// Chat attachments live apart from the Storage mailbox: Storage deletes a file when it is
// downloaded, and a chat file has to stay readable for every later turn.
export const CHAT_UPLOAD_DIR = join(UPLOAD_DIR, 'chat');

mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });

export const attachmentMulterConfig: MulterOptions = {
  storage: diskStorage({
    destination: CHAT_UPLOAD_DIR,
    filename: (_req, file, callback) => {
      // Busboy decodes the multipart filename as latin1; browsers send UTF-8 (see multer.config.ts).
      file.originalname = Buffer.from(file.originalname, 'latin1').toString(
        'utf8',
      );
      callback(
        null,
        `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
      );
    },
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  // Refused before anything is written to disk.
  fileFilter: (_req, file, callback) => {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');

    if (!isAllowedAttachment(name)) {
      callback(
        new BadRequestException(
          'Этот тип файла нельзя прикрепить: подходят изображения (png, jpg, gif, webp), pdf, текст и исходный код',
        ),
        false,
      );
      return;
    }

    callback(null, true);
  },
};
