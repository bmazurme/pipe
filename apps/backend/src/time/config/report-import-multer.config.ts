import { UnsupportedMediaTypeException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

// Reports are small hand-exported CRM spreadsheets, nowhere near storage's
// 200 MB project-zip limit.
export const MAX_REPORT_IMPORT_SIZE_BYTES = 10 * 1024 * 1024;

const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// No `storage` option is set, so multer defaults to keeping the file in
// memory (`file.buffer`) rather than writing it to disk — the report is
// parsed once and never needs to persist as a file.
export const reportImportMulterConfig: MulterOptions = {
  fileFilter: (_req, file, callback) => {
    // Busboy decodes multipart headers (incl. the filename) as latin1, but
    // browsers send it UTF-8-encoded — re-decode before the filename is used
    // to detect the report's year/month.
    file.originalname = Buffer.from(file.originalname, 'latin1').toString(
      'utf8',
    );

    const isXlsx =
      file.mimetype === XLSX_MIME_TYPE ||
      file.originalname.toLowerCase().endsWith('.xlsx');

    callback(
      isXlsx ? null : new UnsupportedMediaTypeException('Ожидается файл .xlsx'),
      isXlsx,
    );
  },
  limits: {
    fileSize: MAX_REPORT_IMPORT_SIZE_BYTES,
  },
};
