import { JwtGuard } from '../auth/guards/jwt.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';

import { BoardsAgentController, BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { BoardReportDto, UpdateResultDto } from './dto/boards.dto';

describe('BoardsAgentController', () => {
  const user = { id: 7 };
  let service: {
    recordReport: jest.Mock;
    pendingFor: jest.Mock;
    recordResult: jest.Mock;
  };
  let controller: BoardsAgentController;

  beforeEach(() => {
    service = {
      recordReport: jest.fn().mockResolvedValue(undefined),
      pendingFor: jest.fn().mockResolvedValue(null),
      recordResult: jest.fn().mockResolvedValue(undefined),
    };
    controller = new BoardsAgentController(service as unknown as BoardsService);
  });

  describe('pending', () => {
    it.each([undefined, '', 'bad host!', '-leading-dash', 'a'.repeat(100)])(
      'answers { update: null } for host %p without asking the service',
      async (host) => {
        const res = await controller.pending(host as string, user);

        expect(res).toEqual({ update: null });
        expect(service.pendingFor).not.toHaveBeenCalled();
      },
    );

    it('answers { update: null } when nothing is pending', async () => {
      const res = await controller.pending('pi-1', user);

      expect(service.pendingFor).toHaveBeenCalledWith(7, 'pi-1');
      expect(res).toEqual({ update: null });
    });

    it('hands the board only id, sha and repoPaths of the pending decision', async () => {
      service.pendingFor.mockResolvedValue({
        id: 3,
        sha: 'a'.repeat(40),
        repoPaths: ['infra/x.sh'],
        userId: 7,
        host: 'pi-1',
        status: 'pending',
        source: 'telegram',
        createdAt: new Date(),
        message: 'secret',
      });

      const res = await controller.pending('pi-1', user);

      expect(res).toEqual({
        update: { id: 3, sha: 'a'.repeat(40), repoPaths: ['infra/x.sh'] },
      });
    });
  });

  it('records a report for the authenticated user, not one named in the body', async () => {
    const dto = {
      host: 'pi-1',
      mainSha: 'b'.repeat(40),
      userId: 99,
    } as unknown as BoardReportDto;

    await controller.report(dto, user);

    expect(service.recordReport).toHaveBeenCalledWith(7, dto);
  });

  it('records a result for the authenticated user, not one named in the body', async () => {
    const dto = {
      ok: false,
      message: 'boom',
      userId: 99,
    } as unknown as UpdateResultDto;

    await controller.result(5, dto, user);

    expect(service.recordResult).toHaveBeenCalledWith(7, 5, false, 'boom');
  });
});

describe('Boards controllers access', () => {
  it('guards the agent routes with JwtOrApiKeyGuard and OwnerGuard', () => {
    expect(Reflect.getMetadata('__guards__', BoardsAgentController)).toEqual([
      JwtOrApiKeyGuard,
      OwnerGuard,
    ]);
  });

  it('guards the page routes with JwtGuard and OwnerGuard', () => {
    expect(Reflect.getMetadata('__guards__', BoardsController)).toEqual([
      JwtGuard,
      OwnerGuard,
    ]);
  });
});
