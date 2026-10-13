import { ArgumentsHost } from '@nestjs/common';
import { MulterError } from 'multer';

import { MAX_ATTACHMENT_BYTES } from '../../chat/attachments';
import {
  MulterExceptionFilter,
  multerExceptionFilterFor,
} from './multer-exception.filter';

function run(
  filter: { catch: (e: MulterError, h: ArgumentsHost) => void },
  error: MulterError,
) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  filter.catch(error, host);

  return { status, json };
}

describe('multer exception filter', () => {
  it('maps the storage size limit to 413 naming 200 MB', () => {
    const { status, json } = run(
      new MulterExceptionFilter(),
      new MulterError('LIMIT_FILE_SIZE'),
    );

    expect(status).toHaveBeenCalledWith(413);
    expect(JSON.stringify(json.mock.calls[0][0])).toContain('200 MB');
  });

  it('maps the chat attachment limit to 413 naming 10 МБ', () => {
    const Filter = multerExceptionFilterFor(
      MAX_ATTACHMENT_BYTES,
      (mb) => `Файл больше ${mb} МБ`,
    );
    const { status, json } = run(
      new Filter(),
      new MulterError('LIMIT_FILE_SIZE'),
    );

    expect(status).toHaveBeenCalledWith(413);
    expect(JSON.stringify(json.mock.calls[0][0])).toContain(
      'Файл больше 10 МБ',
    );
  });

  it('maps other multer errors to 400', () => {
    const { status } = run(
      new MulterExceptionFilter(),
      new MulterError('LIMIT_UNEXPECTED_FILE'),
    );

    expect(status).toHaveBeenCalledWith(400);
  });
});
