import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findCredentials, maskCredentials, scanForCredentials } from './credentials.js';

const ANTHROPIC = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrSt';
const GITHUB = 'ghp_AbCdEfGhIjKlMnOpQrSt1234';
const JWT = 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4';

describe('findCredentials', () => {
  it('recognises the common shapes and labels each', () => {
    const labels = findCredentials(`a ${ANTHROPIC} b ${GITHUB} c ${JWT} d Bearer abcdefghijklmnopqrstuvwxyz`).map((f) => f.label);

    assert.deepEqual(labels, ['ключ Anthropic / OpenAI', 'токен GitHub', 'JWT', 'заголовок Bearer']);
  });

  it('recognises bridge keys, a bot token, a private key and a password in a URL', () => {
    const text = [
      'brk_AbCdEfGhIjKlMnOpQrSt',
      '1234567890:AAEhBP0av18NaNsGXwZSabcdefghijklmnop',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
      'postgres://admin:hunter2pw@db.internal:5432/app',
    ].join('\n');

    assert.deepEqual(
      findCredentials(text).map((f) => f.label),
      ['токен Telegram-бота', 'ключ bridge', 'приватный ключ', 'пароль в адресе'],
    );
  });

  it('never returns the whole value, only its first characters', () => {
    const [finding] = findCredentials(`key ${ANTHROPIC}`);

    assert.equal(finding.preview, 'sk-a***');
    assert.ok(!JSON.stringify(finding).includes('AbCdEf'));
  });

  it('reports a repeated value once', () => {
    assert.equal(findCredentials(`${GITHUB} and again ${GITHUB}`).length, 1);
  });

  it('leaves ordinary text alone', () => {
    const text = 'Почему token: refresh не работает? sk-короткий, https://example.com/a?b=c, user@example.com, ghp_ short, 10.0.0.1';

    assert.deepEqual(findCredentials(text), []);
    assert.equal(maskCredentials(text), text);
  });
});

describe('maskCredentials', () => {
  it('replaces each secret with a label and keeps the text around it', () => {
    assert.equal(
      maskCredentials(`ключ ${ANTHROPIC}, токен ${GITHUB}.`),
      'ключ [скрыто: ключ Anthropic / OpenAI], токен [скрыто: токен GitHub].',
    );
  });

  it('masks every occurrence, and keeps the host of a URL whose password it hid', () => {
    const masked = maskCredentials(`${GITHUB} ${GITHUB} postgres://u:secretpw@db.example.ru/app`);

    assert.equal(masked, '[скрыто: токен GitHub] [скрыто: токен GitHub] [скрыто: пароль в адресе]db.example.ru/app');
  });

  it('can be run twice with the same result', () => {
    const once = maskCredentials(`k ${ANTHROPIC}`);

    assert.equal(maskCredentials(once), once);
  });
});

describe('scanForCredentials', () => {
  it('says in which text and on which line each credential is, without the value', () => {
    const hits = scanForCredentials([
      { source: 'a.ts', content: `const a = 1;\nconst b = 2;\nconst key = '${GITHUB}';` },
      { source: 'issue description', content: `see ${ANTHROPIC}` },
      { source: 'b.ts', content: 'const host = "prod-db.internal.example.ru"; res.status(200); token = req.token;' },
    ]);

    assert.deepEqual(hits, [
      { source: 'a.ts', line: 3, label: 'токен GitHub', preview: 'ghp_***' },
      { source: 'issue description', line: 1, label: 'ключ Anthropic / OpenAI', preview: 'sk-a***' },
    ]);
  });

  it('reports a value repeated within one text once, and the same value in another text again', () => {
    const hits = scanForCredentials([
      { source: 'a', content: `${GITHUB}\n${GITHUB}` },
      { source: 'b', content: GITHUB },
    ]);

    assert.deepEqual(hits.map((hit) => [hit.source, hit.line]), [['a', 1], ['b', 1]]);
  });
});
