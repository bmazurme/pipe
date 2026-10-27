import { describe, it, before, after } from 'node:test';
import { compileDictionary } from '@pipe/protocol';
import { readAndTransform } from './pack.js';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadDictionary, loadOptionalDictionary, localTransform, remoteTransform, toLocal, toRemote } from './dictionary.js';

describe('dictionary', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sync-dictionary-test-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, content: string): string {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  }

  it('parses a Purge export; the first duplicate key wins', () => {
    const file = write('dup.json', JSON.stringify([
      { key: 'Acme', value: 'Zzzz' },
      { key: 'Acme', value: 'Other' },
      { key: 'Bob', value: 'Qqq' },
    ]));
    assert.deepEqual(loadDictionary(file), { Acme: 'Zzzz', Bob: 'Qqq' });
  });

  it('skips empty/non-string keys and turns a non-string value into an empty string', () => {
    const file = write('skip.json', JSON.stringify([
      { key: '', value: 'x' },
      { key: 5, value: 'y' },
      { value: 'z' },
      { key: 'Num', value: 42 },
    ]));
    assert.deepEqual(loadDictionary(file), { Num: '' });
  });

  it('parses a flat object and drops non-string values', () => {
    const file = write('flat.json', JSON.stringify({ Acme: 'Zzzz', Bad: 5 }));
    assert.deepEqual(loadDictionary(file), { Acme: 'Zzzz' });
  });

  it('rejects other JSON shapes, naming the path', () => {
    for (const [name, content] of [['str.json', '"x"'], ['null.json', 'null'], ['num.json', '7']]) {
      const file = write(name, content);
      assert.throws(() => loadDictionary(file), (err: Error) => err.message.includes(file));
    }
  });

  it('throws a "not found" error mentioning the ref for a missing file', () => {
    const ref = path.join(dir, 'missing.json');
    assert.throws(
      () => loadDictionary(ref),
      (err: Error) => err.message.includes('not found') && err.message.includes(ref),
    );
  });

  it('returns an empty dictionary when no ref is given', () => {
    assert.deepEqual(loadOptionalDictionary(undefined), {});
  });

  it('toLocal inverts toRemote, including a Cyrillic term', () => {
    const dictionary = { Acme: 'Zzzz', Газпром: 'Лукойлл' };
    const text = 'Работаем с Acme и Газпром сегодня.';
    const remote = toRemote(dictionary, text);
    assert.notEqual(remote, text);
    assert.equal(toLocal(dictionary, remote), text);
  });
});

describe('compiled transforms', () => {
  it('compile the dictionary once for readAndTransform over several files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sync-dict-once-'));
    try {
      const relPaths = ['a.txt', 'b.txt', 'c.txt'];
      for (const rel of relPaths) writeFileSync(path.join(dir, rel), 'Acme builds Acme');

      let compiles = 0;
      const spy: typeof compileDictionary = (map) => {
        compiles += 1;
        return compileDictionary(map);
      };

      const dictionary = { Acme: 'Zzzz' };
      const remote = readAndTransform(dir, relPaths, remoteTransform(dictionary, spy));
      assert.equal(compiles, 1);
      assert.deepEqual(
        remote.map((f) => f.content),
        ['Zzzz builds Zzzz', 'Zzzz builds Zzzz', 'Zzzz builds Zzzz'],
      );

      const local = localTransform(dictionary, spy);
      assert.equal(compiles, 2);
      assert.equal(local('Zzzz'), 'Acme');
      assert.equal(local('Zzzz Zzzz'), 'Acme Acme');
      assert.equal(compiles, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
