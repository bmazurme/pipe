import { NotFoundException, RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { JwtGuard } from '../auth/guards/jwt.guard';
import { OwnerGuard } from '../auth/guards/owner.guard';
import { UpdateVpnProfileDto } from './dto/vpn-profile.dto';
import {
  VpnProfileController,
  VpnProfilesController,
} from './vpn-profiles.controller';

describe('VpnProfilesController (the owner)', () => {
  it('is a browser session of the owner and nothing else', () => {
    expect(Reflect.getMetadata('__guards__', VpnProfilesController)).toEqual([
      JwtGuard,
      OwnerGuard,
    ]);
  });

  it('lists, creates (token in the answer) and revokes through the service', async () => {
    const profiles = {
      list: jest.fn().mockResolvedValue([{ id: 1 }]),
      create: jest.fn().mockResolvedValue({ id: 2, token: 'brp_x' }),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new VpnProfilesController(profiles as never);

    await expect(controller.list()).resolves.toEqual([{ id: 1 }]);
    await expect(
      controller.create({ label: 'iPhone', audience: 'phone' }),
    ).resolves.toEqual({ id: 2, token: 'brp_x' });
    expect(profiles.create).toHaveBeenCalledWith('iPhone', 'phone');
    await controller.revoke(2);
    expect(profiles.revoke).toHaveBeenCalledWith(2);
    expect(
      Reflect.getMetadata(
        '__httpCode__',
        VpnProfilesController.prototype.revoke,
      ),
    ).toBe(204);
  });
});

describe('VpnProfilesController: rename', () => {
  it('hands the id and the new name to the service and returns what it answers', async () => {
    const profiles = {
      rename: jest.fn().mockResolvedValue({ id: 2, label: 'Новый' }),
    };
    const controller = new VpnProfilesController(profiles as never);

    await expect(controller.rename(2, { label: 'Новый' })).resolves.toEqual({
      id: 2,
      label: 'Новый',
    });
    expect(profiles.rename).toHaveBeenCalledWith(2, 'Новый');
  });

  it('is a PATCH on the profile, behind the same guards as the rest of the owner routes', () => {
    expect(
      Reflect.getMetadata('method', VpnProfilesController.prototype.rename),
    ).toBe(RequestMethod.PATCH);
    expect(
      Reflect.getMetadata('path', VpnProfilesController.prototype.rename),
    ).toBe(':id');
  });
});

describe('UpdateVpnProfileDto', () => {
  const check = async (label: unknown) =>
    validate(plainToInstance(UpdateVpnProfileDto, { label }));

  it('trims the name, and accepts one that is left', async () => {
    const dto = plainToInstance(UpdateVpnProfileDto, { label: '  Mac  ' });

    expect(dto.label).toBe('Mac');
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('refuses an empty one, spaces only, over 100 characters, and a non-string', async () => {
    expect(await check('')).not.toEqual([]);
    expect(await check('    ')).not.toEqual([]);
    expect(await check('x'.repeat(101))).not.toEqual([]);
    expect(await check('x'.repeat(100))).toEqual([]);
    expect(await check(12)).not.toEqual([]);
  });
});

describe('VpnProfileController (a device)', () => {
  const build = (authenticated: object | null) => {
    const profiles = {
      authenticate: jest.fn().mockResolvedValue(authenticated),
      build: jest.fn().mockResolvedValue({
        links: ['vless://a#x', 'vless://b#y'],
        failed: [],
      }),
    };
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => void (headers[name] = value),
    };

    return {
      controller: new VpnProfileController(profiles as never),
      profiles,
      headers,
      response: response as never,
    };
  };

  it('has no guard: the token in the address is the credential', () => {
    expect(
      Reflect.getMetadata('__guards__', VpnProfileController),
    ).toBeUndefined();
  });

  it('is throttled on its own, below the default', () => {
    const limit = Reflect.getMetadata(
      'THROTTLER:LIMITdefault',
      VpnProfileController.prototype.get,
    );

    expect(limit).toBe(30);
  });

  it('answers with the base64 list and the headers a client reads', async () => {
    const { controller, headers, response } = build({ id: 3 });

    const body = await controller.get('brp_secret', response);

    expect(Buffer.from(body, 'base64').toString('utf8')).toBe(
      'vless://a#x\nvless://b#y',
    );
    expect(headers).toEqual({
      'profile-title': 'pipe-bridge',
      'profile-update-interval': '1',
    });
  });

  it('is never cached', () => {
    expect(
      Reflect.getMetadata('__headers__', VpnProfileController.prototype.get),
    ).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]),
    );
  });

  it('answers 404 to an unknown or revoked token and builds nothing', async () => {
    const { controller, profiles, response } = build(null);

    await expect(controller.get('brp_nope', response)).rejects.toThrow(
      NotFoundException,
    );
    expect(profiles.build).not.toHaveBeenCalled();
  });
});
