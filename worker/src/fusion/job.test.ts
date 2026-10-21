import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prepareFusionJob } from './job.js';
import { fusionInstructions } from './prompt.js';

describe('a job that needs Fusion 360', () => {
  it('tells the model how to drive Fusion, with the path of the tool', async () => {
    const logs: string[] = [];
    const prompt = await prepareFusionJob('Build the hull', {
      ctlPath: '/opt/worker/dist/fusion/fusionctl.js',
      providerTool: 'claude',
      log: (text) => logs.push(text),
      check: async () => ({ document: 'boat', version: '2.0.1' }),
    });

    assert.ok(prompt.startsWith('Build the hull'));
    assert.match(prompt, /node "\/opt\/worker\/dist\/fusion\/fusionctl\.js" run <script\.py>/);
    assert.match(prompt, /screenshot <out\.png>/);
    assert.deepEqual(logs, ['Fusion 360 is reachable (2.0.1), active document: boat\n']);
  });

  it('fails before the model starts when Fusion does not answer', async () => {
    await assert.rejects(
      () =>
        prepareFusionJob('x', {
          ctlPath: '/c.js',
          providerTool: 'claude',
          log: () => undefined,
          check: async () => {
            throw new Error('Cannot reach the pipe add-in');
          },
        }),
      /Cannot reach/,
    );
  });

  it('refuses a model that has no shell to run the tool in', async () => {
    await assert.rejects(
      () => prepareFusionJob('x', { ctlPath: '/c.js', providerTool: 'openai', log: () => undefined, check: async () => ({ document: null, version: null }) }),
      /needs a Claude model/,
    );
  });

  it('quotes a path with spaces', () => {
    assert.match(fusionInstructions('/Users/me/My Worker/fusionctl.js'), /node "\/Users\/me\/My Worker\/fusionctl\.js" health/);
  });
});
