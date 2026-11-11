import { BOARD_AGENT_KEY_ALLOWED } from '../auth/decorators/board-agent-key-allowed.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import {
  LinksAgentController,
  LinksDashboardController,
} from './links.controller';

describe('LinksAgentController', () => {
  it("is the owner's boards-only key or session, like the other agents", () => {
    expect(Reflect.getMetadata('__guards__', LinksAgentController)).toEqual([
      JwtOrApiKeyGuard,
      OwnerGuard,
    ]);
    expect(
      Reflect.getMetadata(BOARD_AGENT_KEY_ALLOWED, LinksAgentController),
    ).toBe(true);
  });

  it('hands the agent the channels to probe, and files what it reports (204)', async () => {
    const links = {
      channels: jest.fn().mockResolvedValue([{ key: 'a:443' }]),
      ingest: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new LinksAgentController(links as never);
    const dto = {
      vantage: 'ubuntu-white',
      results: [{ key: 'a:443', result: 'ok' as const }],
    };

    await expect(controller.channels()).resolves.toEqual([{ key: 'a:443' }]);
    await expect(controller.report(dto)).resolves.toBeUndefined();
    expect(links.ingest).toHaveBeenCalledWith('ubuntu-white', dto.results);
    expect(
      Reflect.getMetadata(
        '__httpCode__',
        LinksAgentController.prototype.report,
      ),
    ).toBe(204);
  });
});

describe('LinksDashboardController', () => {
  it('is a browser session of the owner', () => {
    expect(Reflect.getMetadata('__guards__', LinksDashboardController)).toEqual(
      [JwtGuard, OwnerGuard],
    );
  });

  it('answers with the view', async () => {
    const links = { view: jest.fn().mockResolvedValue({ status: 'ok' }) };

    await expect(
      new LinksDashboardController(links as never).view(),
    ).resolves.toEqual({ status: 'ok' });
  });
});
