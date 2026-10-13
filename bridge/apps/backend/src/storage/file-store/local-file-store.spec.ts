import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileMissingError } from './file-store';
import { LocalFileStore } from './local-file-store';

describe('LocalFileStore', () => {
  let root: string;
  let store: LocalFileStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'local-store-'));
    store = new LocalFileStore(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('puts, stats, reads and removes a file', async () => {
    await store.put('a.zip', Buffer.from('hello'));

    expect(await store.stat('a.zip')).toEqual({ size: 5 });
    expect(await store.readBytes('a.zip')).toEqual(Buffer.from('hello'));

    await store.remove('a.zip');

    expect(await store.stat('a.zip')).toBeNull();
    expect(existsSync(join(root, 'a.zip'))).toBe(false);
  });

  it('keeps chat attachments in the chat/ subdirectory of the same root, creating it when needed', async () => {
    await store.put('chat/b.png', Buffer.from('png'));

    expect(readFileSync(join(root, 'chat', 'b.png'), 'utf8')).toBe('png');
    expect(store.localPath('chat/b.png')).toBe(join(root, 'chat', 'b.png'));
  });

  it('streams a file back', async () => {
    await store.put('c.txt', Buffer.from('stream me'));

    const chunks: Buffer[] = [];

    for await (const chunk of await store.openRead('c.txt')) {
      chunks.push(chunk as Buffer);
    }

    expect(Buffer.concat(chunks).toString()).toBe('stream me');
  });

  it('says FileMissingError for a file that is not there (read and stream)', async () => {
    await expect(store.readBytes('nope.zip')).rejects.toBeInstanceOf(
      FileMissingError,
    );
    await expect(store.openRead('nope.zip')).rejects.toBeInstanceOf(
      FileMissingError,
    );
  });

  it('removing what is not there is not an error', async () => {
    await expect(store.remove('nope.zip')).resolves.toBeUndefined();
  });

  it('adopt is a no-op for a file multer already wrote to its final place', async () => {
    mkdirSync(join(root, 'chat'), { recursive: true });
    const staged = join(root, 'chat', 'd.png');

    writeFileSync(staged, 'x');
    await store.adopt('chat/d.png', staged);

    expect(readFileSync(staged, 'utf8')).toBe('x');
  });

  it('adopt moves a file from a staging directory into place', async () => {
    const staging = mkdtempSync(join(tmpdir(), 'staging-'));
    const staged = join(staging, 'e.zip');

    writeFileSync(staged, 'moved');
    await store.adopt('e.zip', staged);

    expect(readFileSync(join(root, 'e.zip'), 'utf8')).toBe('moved');
    expect(existsSync(staged)).toBe(false);
    rmSync(staging, { recursive: true, force: true });
  });

  it('refuses a key that climbs out of the root', async () => {
    expect(() => store.localPath('../outside.zip')).toThrow(
      /Refusing the file key/,
    );
    expect(() => store.localPath('chat/../../outside')).toThrow(/Refusing/);
    expect(() => store.localPath('/etc/passwd')).toThrow(/Refusing/);
    await expect(store.put('../x', Buffer.from('1'))).rejects.toThrow(
      /Refusing/,
    );
  });
});
