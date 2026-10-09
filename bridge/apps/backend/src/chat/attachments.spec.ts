import {
  contentTypeOf,
  isAllowedAttachment,
  isImageAttachment,
} from './attachments';

describe('attachment types', () => {
  it.each([
    'photo.PNG',
    'shot.jpeg',
    'a.webp',
    'doc.pdf',
    'notes.md',
    'main.ts',
    'data.json',
    'build.log',
  ])('allows %s', (name) => {
    expect(isAllowedAttachment(name)).toBe(true);
  });

  it.each([
    'run.exe',
    'archive.zip',
    'script.bat',
    '.env',
    'id_rsa',
    'noextension',
    'x.svg',
    'x.js.exe',
    'x.dll',
  ])('refuses %s', (name) => {
    expect(isAllowedAttachment(name)).toBe(false);
  });

  it('tells images from other files by extension, whatever the case', () => {
    expect(isImageAttachment('a.PNG')).toBe(true);
    expect(isImageAttachment('a.jpg')).toBe(true);
    expect(isImageAttachment('a.pdf')).toBe(false);
    expect(isImageAttachment('a.txt')).toBe(false);
  });

  it('serves images with their type and everything else as opaque bytes', () => {
    expect(contentTypeOf('a.png')).toBe('image/png');
    expect(contentTypeOf('a.jpeg')).toBe('image/jpeg');
    expect(contentTypeOf('page.html')).toBe('application/octet-stream');
    expect(contentTypeOf('a.txt')).toBe('application/octet-stream');
  });
});
