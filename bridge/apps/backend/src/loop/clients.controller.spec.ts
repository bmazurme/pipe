import { ClientsController } from './clients.controller';

function setup() {
  const telegram = { send: jest.fn().mockResolvedValue(true) };
  const controller = new ClientsController({} as never, telegram as never);

  return { controller, telegram };
}

describe('ClientsController.event', () => {
  it('relays a pulled result with its branch', async () => {
    const { controller, telegram } = setup();

    await controller.event({
      name: 'mac',
      type: 'pulled',
      taskKey: '1:2',
      branch: 'b',
    });

    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('в ветку b'),
    );
  });

  it('relays a failed pull with its error', async () => {
    const { controller, telegram } = setup();

    await controller.event({
      name: 'mac',
      type: 'pull_failed',
      taskKey: '1:2',
      error: 'dirty',
    });

    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('dirty'),
    );
  });

  it('relays how many issues an analysis created', async () => {
    const { controller, telegram } = setup();

    await controller.event({
      name: 'mac',
      type: 'issues_created',
      taskKey: '1:m-x',
      count: 3,
    });

    expect(telegram.send).toHaveBeenCalledWith(
      expect.stringContaining('создано задач в GitHub: 3'),
    );
  });
});
