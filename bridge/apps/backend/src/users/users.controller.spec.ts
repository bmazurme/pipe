import { ValidationPipe } from '@nestjs/common';

import { UpdateUserDto } from './dto/update-user.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController.update', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const transform = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateUserDto });

  it('strips email from the PATCH body so it cannot be changed', async () => {
    const update = jest.fn().mockResolvedValue({});
    const controller = new UsersController({
      update,
    } as unknown as UsersService);

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
