import {
  checkLandingPath,
  releaseDirName,
  releaseFiles,
} from './landing-files';

const bytes = (text = 'x') => new TextEncoder().encode(text);

describe('checkLandingPath', () => {
  it('accepts ordinary site files', () => {
    expect(checkLandingPath('index.html')).toBe('index.html');
    expect(checkLandingPath('fonts/plex-sans-latin.woff2')).toBe(
      'fonts/plex-sans-latin.woff2',
    );
    expect(checkLandingPath('images/runs/14-11/a.JPG')).toBe(
      'images/runs/14-11/a.JPG',
    );
  });

  it.each([
    ['../evil.html', /выходит за каталог/],
    ['a/../../evil.html', /выходит за каталог/],
    ['/etc/passwd.txt', /Абсолютный/],
    ['C:/x.html', /Абсолютный/],
    ['a\\b.html', /Недопустимый/],
    ['.env.txt', /Скрыт/],
    ['dir/.hidden/a.html', /Скрыт/],
    ['run.php', /не разрешён/],
    ['bin/tool.exe', /не разрешён/],
    ['noextension', /не разрешён/],
  ])('refuses %s', (path, message) => {
    expect(() => checkLandingPath(path)).toThrow(message);
  });
});

describe('releaseFiles', () => {
  it('takes the files, drops directories and Mac junk', () => {
    const files = releaseFiles({
      'index.html': bytes(),
      'images/': bytes(''),
      'images/a.png': bytes(),
      '.DS_Store': bytes(),
      '__MACOSX/._index.html': bytes(),
      'images/._a.png': bytes(),
    });

    expect(files.map((f) => f.path).sort()).toEqual([
      'images/a.png',
      'index.html',
    ]);
  });

  it('strips one wrapping folder (an archive of a folder)', () => {
    const files = releaseFiles({
      'site/index.html': bytes(),
      'site/css/a.css': bytes(),
    });

    expect(files.map((f) => f.path).sort()).toEqual([
      'css/a.css',
      'index.html',
    ]);
  });

  it('does not strip a folder when index.html sits in the root next to it', () => {
    const files = releaseFiles({ 'index.html': bytes(), 'img/a.png': bytes() });

    expect(files.map((f) => f.path).sort()).toEqual([
      'img/a.png',
      'index.html',
    ]);
  });

  it('requires index.html in the root', () => {
    expect(() => releaseFiles({ 'a.html': bytes() })).toThrow(/index\.html/);
    expect(() =>
      releaseFiles({
        'sub/index.html': bytes(),
        'sub/x/a.css': bytes(),
        'other/b.css': bytes(),
      }),
    ).toThrow(/index\.html/);
  });

  it('refuses an empty archive and a path that leaves the folder', () => {
    expect(() => releaseFiles({ 'dir/': bytes('') })).toThrow(/нет файлов/);
    expect(() =>
      releaseFiles({ 'index.html': bytes(), '../x.html': bytes() }),
    ).toThrow(/выходит/);
  });
});

describe('releaseDirName', () => {
  it('sorts by time', () => {
    expect(releaseDirName(new Date('2026-11-14T08:05:09Z'), 'ab12cd34')).toBe(
      'r20261114080509-ab12cd34',
    );
  });
});
