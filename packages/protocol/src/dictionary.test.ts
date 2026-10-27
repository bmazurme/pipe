import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyDictionary, compileDictionary } from './dictionary.js';

describe('applyDictionary', () => {
  const toRemote = new Map([
    ['prod-db.internal.example.com', '{{DB_HOST}}'],
    ['db', '{{DB}}'],
  ]);
  const toLocal = new Map([...toRemote].map(([k, v]) => [v, k]));

  it('replaces real values with placeholders', () => {
    assert.equal(applyDictionary('host: prod-db.internal.example.com', toRemote).result, 'host: {{DB_HOST}}');
  });

  it('replaces placeholders back with real values', () => {
    assert.equal(applyDictionary('host: {{DB_HOST}}', toLocal).result, 'host: prod-db.internal.example.com');
  });

  it('matches the longest key first so a shorter key does not shadow it', () => {
    assert.equal(
      applyDictionary('prod-db.internal.example.com and db', toRemote).result,
      '{{DB_HOST}} and {{DB}}',
    );
  });

  it('does not match inside a longer identifier (word-boundary safe)', () => {
    assert.equal(applyDictionary('userId', toRemote).result, 'userId');
  });

  it('passes text through unchanged for an empty dictionary', () => {
    assert.equal(applyDictionary('anything', new Map()).result, 'anything');
  });

  it('counts the number of substitutions made', () => {
    assert.equal(applyDictionary('db and db again', toRemote).count, 2);
  });

  describe('Cyrillic text', () => {
    const cyrToRemote = new Map([['Иван', '{{PERSON}}']]);
    const cyrToLocal = new Map([['{{PERSON}}', 'Иван']]);

    it('replaces a Cyrillic key on word boundaries', () => {
      const out = applyDictionary('Привет, Иван! Иван тут.', cyrToRemote);
      assert.equal(out.result, 'Привет, {{PERSON}}! {{PERSON}} тут.');
      assert.equal(out.count, 2);
    });

    it('does not replace inside a longer Cyrillic word', () => {
      for (const text of ['Иванов', 'сИван', 'Иван1', 'Иван_x']) {
        assert.deepEqual(applyDictionary(text, cyrToRemote), { result: text, count: 0 });
      }
    });

    it('replaces placeholders back to Cyrillic values', () => {
      assert.equal(applyDictionary('Привет, {{PERSON}}!', cyrToLocal).result, 'Привет, Иван!');
    });

    it('does not replace a Cyrillic replacement target inside a longer word on the way back', () => {
      const back = new Map([['кот', 'пес']]);
      assert.equal(applyDictionary('кот котик скот кот', back).result, 'пес котик скот пес');
    });
  });

  describe('empty keys', () => {
    it('is a no-op when the only key is the empty string', () => {
      assert.deepEqual(applyDictionary('some text', new Map([['', 'X']])), { result: 'some text', count: 0 });
    });

    it('ignores an empty key alongside real keys', () => {
      assert.equal(applyDictionary('db', new Map([['', 'X'], ['db', 'Y']])).result, 'Y');
    });
  });

  describe('regex metacharacters in keys', () => {
    it('matches a key with a dot literally', () => {
      const dict = new Map([['a.b', 'X']]);
      assert.equal(applyDictionary('a.b axb', dict).result, 'X axb');
    });

    it('matches other metacharacters literally', () => {
      const dict = new Map([
        ['a+b', 'P'],
        ['(x|y)', 'Q'],
        ['c*d?', 'R'],
        ['[z]', 'S'],
        ['e\\f', 'T'],
      ]);
      assert.equal(applyDictionary('a+b (x|y) c*d? [z] e\\f', dict).result, 'P Q R S T');
      assert.equal(applyDictionary('aab x y ccd z', dict).count, 0);
    });
  });
});

describe('compileDictionary', () => {
  const dict = new Map([
    ['prod-db.internal.example.com', '{{DB_HOST}}'],
    ['db', '{{DB}}'],
    ['Газпром', 'Лукойлл'],
  ]);

  it('gives the same results and counts as applyDictionary', () => {
    const texts = ['prod-db.internal.example.com and db', 'userId', 'Газпром, Газпромбанк', ''];
    const apply = compileDictionary(dict);
    for (const text of texts) {
      assert.deepEqual(apply(text), applyDictionary(text, dict));
    }
    assert.deepEqual(apply('prod-db.internal.example.com and db'), { result: '{{DB_HOST}} and {{DB}}', count: 2 });
  });

  it('can be applied to several texts in a row', () => {
    const apply = compileDictionary(dict);
    assert.deepEqual(apply('db db'), { result: '{{DB}} {{DB}}', count: 2 });
    assert.deepEqual(apply('no match'), { result: 'no match', count: 0 });
    assert.deepEqual(apply('x db'), { result: 'x {{DB}}', count: 1 });
    assert.deepEqual(apply('Газпром'), { result: 'Лукойлл', count: 1 });
  });

  it('returns the text unchanged with count 0 for an empty dictionary', () => {
    assert.deepEqual(compileDictionary(new Map())('db'), { result: 'db', count: 0 });
    assert.deepEqual(compileDictionary(new Map([['', 'x']]))('db'), { result: 'db', count: 0 });
  });
});
