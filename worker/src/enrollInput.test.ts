import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readEnrollCode } from './enrollInput.js';

const never = async () => {
  throw new Error('stdin must not be read');
};

describe('readEnrollCode', () => {
  it('takes the command-line argument, trimmed', async () => {
    assert.equal(await readEnrollCode(['  brn_a  '], {}, never), 'brn_a');
  });

  it('`-` reads the code from stdin, so it is never on a command line', async () => {
    assert.equal(await readEnrollCode(['-'], {}, async () => 'brn_b\n'), 'brn_b');
  });

  it('an empty stdin is no code at all', async () => {
    assert.equal(await readEnrollCode(['-'], { WORKER_ENROLL_CODE: 'brn_env' }, async () => '  \n'), undefined);
  });

  it('falls back to WORKER_ENROLL_CODE when there is no argument', async () => {
    assert.equal(await readEnrollCode([], { WORKER_ENROLL_CODE: ' brn_env ' }, never), 'brn_env');
  });

  it('the argument wins over the environment', async () => {
    assert.equal(await readEnrollCode(['brn_arg'], { WORKER_ENROLL_CODE: 'brn_env' }, never), 'brn_arg');
  });

  it('is undefined when nothing was given anywhere', async () => {
    assert.equal(await readEnrollCode([], {}, never), undefined);
    assert.equal(await readEnrollCode(['  '], { WORKER_ENROLL_CODE: '' }, never), undefined);
  });
});
