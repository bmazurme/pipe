import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { ChatToolsController } from './chat-tools.controller';
import { CHAT_TOOL_DEFINITIONS, toolNames } from './chat-tools';

function setup(owner = true) {
  const facts = {
    isOwner: jest.fn().mockResolvedValue(owner),
    render: jest.fn().mockResolvedValue('RENDERED'),
    recent: jest.fn().mockResolvedValue([
      {
        source: 'worker-job',
        id: 3,
        status: 'failed',
        model: 'haiku',
        title: '',
        at: new Date('2026-11-27T10:00:00Z'),
      },
    ]),
  };

  return { controller: new ChatToolsController(facts as never), facts };
}

describe('the chat tools', () => {
  it('offer only reads: nothing that starts, stops or changes', () => {
    expect(toolNames()).toEqual([
      'system_status',
      'explain_run',
      'recent_runs',
    ]);
    for (const definition of CHAT_TOOL_DEFINITIONS) {
      expect(definition.function.name).not.toMatch(
        /create|start|stop|delete|merge|set|update|retry/,
      );
    }
  });
});

describe('ChatToolsController', () => {
  it('lists the tools for the owner, with the prompt that explains them', async () => {
    const { controller } = setup();
    const out = await controller.list({ id: 1 });

    expect(out.definitions).toHaveLength(3);
    expect(out.prompt).toContain('read-only');
  });

  it('offers a non-owner nothing', async () => {
    const { controller } = setup(false);

    expect(await controller.list({ id: 2 })).toEqual({
      definitions: [],
      prompt: '',
    });
  });

  it('refuses a call from a non-owner', async () => {
    const { controller, facts } = setup(false);

    await expect(
      controller.call({ id: 2 }, { name: 'system_status' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(facts.render).not.toHaveBeenCalled();
  });

  it('refuses an unknown tool, including one that would write', async () => {
    const { controller } = setup();

    await expect(
      controller.call(
        { id: 1 },
        { name: 'create_job', args: { sourceFileId: 1, model: 'opus' } },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('runs system_status and explain_run through the same renderer the chat uses', async () => {
    const { controller, facts } = setup();

    expect(await controller.call({ id: 1 }, { name: 'system_status' })).toEqual(
      { result: 'RENDERED' },
    );
    expect(facts.render).toHaveBeenCalledWith(1, { kind: 'broken' });

    await controller.call({ id: 1 }, { name: 'explain_run', args: { id: 12 } });
    expect(facts.render).toHaveBeenCalledWith(1, { kind: 'explain', id: 12 });
  });

  it('asks for a sensible id', async () => {
    const { controller, facts } = setup();

    for (const id of [undefined, 'x', -3, 1.5]) {
      expect(
        (
          await controller.call(
            { id: 1 },
            { name: 'explain_run', args: { id } },
          )
        ).result,
      ).toContain('positive integer');
    }
    expect(facts.render).not.toHaveBeenCalled();
  });

  it('lists the recent runs as JSON', async () => {
    const { controller, facts } = setup();
    const out = await controller.call(
      { id: 1 },
      { name: 'recent_runs', args: { limit: 5, status: 'failed' } },
    );

    expect(facts.recent).toHaveBeenCalledWith(1, 5, 'failed');
    expect(JSON.parse(out.result)).toEqual([
      {
        kind: 'worker-job',
        id: 3,
        status: 'failed',
        model: 'haiku',
        at: '2026-11-27T10:00:00.000Z',
      },
    ]);
  });

  it('cuts a very long answer', async () => {
    const { controller, facts } = setup();

    facts.render.mockResolvedValue('x'.repeat(20_000));

    expect(
      (await controller.call({ id: 1 }, { name: 'system_status' })).result
        .length,
    ).toBeLessThanOrEqual(6001);
  });
});
