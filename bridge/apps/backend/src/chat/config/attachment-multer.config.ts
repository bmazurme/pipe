import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import {
  decodeMultipartName,
  diskStorageIn,
  ensureUploadDir,
} from '../../uploads/upload-files';
import { isAllowedAttachment, MAX_ATTACHMENT_BYTES } from '../attachments';

// Chat attachments live apart from the Storage mailbox: Storage deletes a file when it is
// downloaded, and a chat file has to stay readable for every later turn.
export const CHAT_UPLOAD_DIR = ensureUploadDir('chat');

export const attachmentMulterConfig: MulterOptions = {
  storage: diskStorageIn(CHAT_UPLOAD_DIR),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  // Refused before anything is written to disk.
  fileFilter: (_req, file, callback) => {
    const name = decodeMultipartName(file.originalname);

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
