import { describe, expect, it } from 'vitest';

import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, parseAttachments } from './attachments';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const attach = (name: string, bytes: Buffer) => ({ name, base64: bytes.toString('base64') });

describe('parseAttachments', () => {
  it('turns screenshots into parcel images named by what they really are', () => {
    const images = parseAttachments([attach('Снимок экрана 1.png', PNG), attach('photo.jpeg', JPEG)]);

    expect(images.map((image) => image.relPath)).toEqual(['issue-images/Снимок-экрана-1.png', 'issue-images/photo.jpg']);
    expect(Buffer.from(images[0].base64, 'base64')).toEqual(PNG);
  });

  it('is empty when nothing was attached', () => {
    expect(parseAttachments(undefined)).toEqual([]);
    expect(parseAttachments([])).toEqual([]);
  });

  it('keeps names unique, also against the images the issue already carries', () => {
    const images = parseAttachments([attach('image.png', PNG), attach('image.png', PNG)], ['image.png']);

    expect(images.map((image) => image.relPath)).toEqual(['issue-images/image-2.png', 'issue-images/image-3.png']);
  });

  it('never lets a name leave the images folder', () => {
    const [image] = parseAttachments([attach('../../.git/config.png', PNG)]);

    expect(image.relPath).toBe('issue-images/config.png');
  });

  it('takes any other file as it is, into its own folder, under its own extension', () => {
    const images = parseAttachments([
      attach('Письмо клиента.msg', Buffer.from('MSG bytes \u0000\u0001')),
      attach('Config.JSON', Buffer.from('{"a": 1}')),
      attach('README', Buffer.from('no extension')),
    ]);

    expect(images.map((image) => image.relPath)).toEqual([
      'issue-attachments/Письмо-клиента.msg',
      'issue-attachments/Config.json',
      'issue-attachments/README',
    ]);
    expect(Buffer.from(images[1].base64, 'base64').toString()).toBe('{"a": 1}');
  });

  it('does not trust the name of a picture: what is not one by its bytes is an ordinary file', () => {
    const [file] = parseAttachments([attach('evil.png', Buffer.from('#!/bin/sh\nrm -rf /'))]);

    expect(file.relPath).toBe('issue-attachments/evil.png');
  });

  it('keeps every name inside its folder and every extension harmless', () => {
    const images = parseAttachments([attach('../../.git/hooks/pre-commit', Buffer.from('x')), attach('a.b/../c.s h', Buffer.from('y')), attach('weird.' + 'x'.repeat(40), Buffer.from('z'))]);

    expect(images.map((image) => image.relPath)).toEqual(['issue-attachments/pre-commit', 'issue-attachments/c', 'issue-attachments/weird']);
    for (const image of images) expect(image.relPath).toMatch(/^issue-attachments\/[^/]+$/);
  });

  it('keeps file names unique within their own folder', () => {
    const images = parseAttachments([attach('data.json', Buffer.from('1')), attach('data.json', Buffer.from('2')), attach('data.png', PNG)]);

    expect(images.map((image) => image.relPath)).toEqual(['issue-attachments/data.json', 'issue-attachments/data-2.json', 'issue-images/data.png']);
  });

  it('counts every kind of file towards the total limit', () => {
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES - 1, 1);

    expect(() => parseAttachments([attach('a.bin', big), attach('b.bin', big), attach('c.bin', big)])).toThrow(/общий лимит/);
  });

  it('refuses too many, an empty one and a huge one', () => {
    expect(() => parseAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => attach('a.png', PNG)))).toThrow(/Слишком много/);
    expect(() => parseAttachments([{ name: 'a.png', base64: '' }])).toThrow(/нет имени или содержимого/);
    expect(() => parseAttachments([attach('big.png', Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]))])).toThrow(/больше/);
  });

  it('refuses a body that is not a list', () => {
    expect(() => parseAttachments({ name: 'a.png' })).toThrow(/неверном формате/);
  });
});
