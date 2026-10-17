import { ValidationPipe } from '@nestjs/common';

import { DeploymentAccessService } from '../auth/deployment-access';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController.update', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateUserDto });

  it('strips email from the PATCH body so it cannot be changed', async () => {
    const update = jest.fn().mockResolvedValue({});
    const controller = new UsersController(
      { update } as unknown as UsersService,
      {} as DeploymentAccessService,
    );

    const dto = await transform({ email: 'other@x.com', status: 'busy' });
    await controller.update(1, dto, { id: 1 });

    expect(update).toHaveBeenCalledTimes(1);
    const fields = update.mock.calls[0][1] as Record<string, unknown>;
    expect(fields).not.toHaveProperty('email');
    expect(fields.status).toBe('busy');
  });

  it('still accepts status alone', async () => {
    const dto = await transform({ status: 'away' });

    expect(dto.status).toBe('away');
  });
});

describe('UsersController.getMe', () => {
  const user = { id: 7, email: 'me@x.com', status: 'online' };

  const makeController = (isOwner: boolean) => {
    const access = { isOwner: jest.fn().mockResolvedValue(isOwner) };
    const controller = new UsersController(
      {
        findById: jest.fn().mockResolvedValue(user),
      } as unknown as UsersService,
      access as unknown as DeploymentAccessService,
    );

    return { controller, access };
  };

  it('reports isOwner: true for the deployment owner', async () => {
    const { controller, access } = makeController(true);

    await expect(controller.getMe({ id: 7 })).resolves.toEqual({
      id: 7,
      username: 'me@x.com',
      status: 'online',
      isOwner: true,
    });
    expect(access.isOwner).toHaveBeenCalledWith(7);
  });

  it('reports isOwner: false for any other account', async () => {
    const { controller } = makeController(false);

    await expect(controller.getMe({ id: 7 })).resolves.toMatchObject({
      isOwner: false,
    });
  });
});
