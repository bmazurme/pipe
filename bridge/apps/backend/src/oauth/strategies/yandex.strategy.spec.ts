import { ConfigService } from '@nestjs/config';

import { YandexStrategy } from './yandex.strategy';

function configServiceWith(
  values: Record<string, string | undefined>,
): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

// `private static readonly logger` is a compile-time restriction only —
// reaching in to assert on it beats asserting on real console output.
function loggerWarnSpy() {
  return jest.spyOn(
    (YandexStrategy as unknown as { logger: { warn: jest.Mock } }).logger,
    'warn',
  );
}

describe('YandexStrategy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('constructs without throwing when YANDEX_ID/YANDEX_SECRET are not configured', () => {
    // passport-oauth2's Strategy constructor throws synchronously on a
    // falsy clientID, which would otherwise crash the whole Nest app at
    // boot for anyone running without a real Yandex app configured.
    loggerWarnSpy().mockImplementation(() => undefined);

    expect(() => new YandexStrategy(configServiceWith({}))).not.toThrow();
  });

  it('warns when falling back to the placeholder clientID', () => {
    const spy = loggerWarnSpy().mockImplementation(() => undefined);

    new YandexStrategy(configServiceWith({}));

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('YANDEX_ID is not configured'),
    );
  });

  it('does not warn when YANDEX_ID is configured', () => {
    const spy = loggerWarnSpy().mockImplementation(() => undefined);

    new YandexStrategy(
      configServiceWith({
        YANDEX_ID: 'real-client-id',
        YANDEX_SECRET: 'real-secret',
      }),
    );

    expect(spy).not.toHaveBeenCalled();
  });
});
