import { decodeMultipartName, diskStorageIn } from './upload-files';

describe('upload-files', () => {
  it('decodes a Cyrillic name that busboy read as latin1', () => {
    const mangled = Buffer.from('Отчёт.txt', 'utf8').toString('latin1');

    expect(decodeMultipartName(mangled)).toBe('Отчёт.txt');
  });

  it('keeps ASCII names unchanged', () => {
    expect(decodeMultipartName('report.txt')).toBe('report.txt');
  });

  it('stores under a random name with a lowercased extension and decoded originalname', (done) => {
    const engine = diskStorageIn('/tmp');
    const file = {
      originalname: Buffer.from('Файл.PDF', 'utf8').toString('latin1'),
    } as Express.Multer.File;
    const filename = (
      engine as unknown as {
        getFilename: (
          req: unknown,
          f: Express.Multer.File,
          cb: (e: unknown, name: string) => void,
        ) => void;
      }
    ).getFilename;

    filename({}, file, (err, name) => {
      expect(err).toBeNull();
      expect(name).toMatch(/^[0-9a-f-]{36}\.pdf$/);
      expect(file.originalname).toBe('Файл.PDF');
      done();
    });
  });
});
