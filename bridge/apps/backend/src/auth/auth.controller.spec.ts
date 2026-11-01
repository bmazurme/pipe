import { Request } from 'express';
import { AuthController } from './auth.controller';

describe('AuthController credential-creation alerts', () => {
  const authService = { announceCredentialCreated: jest.fn() };
  const apiKeysService = { create: jest.fn() };
  const emergencyKeysService = { createOrReplace: jest.fn() };
  const request = { ip: '1.2.3.4' } as Request;
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(
      authService as never,
      apiKeysService as never,
      emergencyKeysService as never,
    );
  });

  it('announces a created emergency key with the request ip', async () => {
    emergencyKeysService.createOrReplace.mockResolvedValue({ key: 'bre_x' });

    await expect(
      controller.createEmergencyKey({ id: 7 }, request),
    ).resolves.toEqual({ key: 'bre_x' });
    expect(authService.announceCredentialCreated).toHaveBeenCalledWith(
      'emergency',
      7,
      undefined,
      '1.2.3.4',
    );
  });

  it('announces a created API key without the token', async () => {
    apiKeysService.create.mockResolvedValue({
      id: 1,
      name: 'ci',
      prefix: 'brk_ab',
      scope: null,
      token: 'brk_secret',
      expiresAt: null,
      createdAt: new Date(),
    });

    await controller.createApiKey({ name: 'ci' }, { id: 7 }, request);

    const args = authService.announceCredentialCreated.mock.calls[0];
    expect(args.slice(0, 4)).toEqual(['api-key', 7, 'ci', '1.2.3.4']);
    expect(JSON.stringify(args)).not.toContain('brk_secret');
  });
});
