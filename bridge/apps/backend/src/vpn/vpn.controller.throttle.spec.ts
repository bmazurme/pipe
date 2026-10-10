import { VpnController } from './vpn.controller';

const LIMIT_KEY = 'THROTTLER:LIMITdefault';
const TTL_KEY = 'THROTTLER:TTLdefault';

describe('VpnController throttle scoping', () => {
  const proto = VpnController.prototype;

  it('puts no throttle override on the class', () => {
    expect(Reflect.getMetadata(LIMIT_KEY, VpnController)).toBeUndefined();
    expect(Reflect.getMetadata(TTL_KEY, VpnController)).toBeUndefined();
  });

  it('puts no throttle override on the polled getStatus route', () => {
    expect(Reflect.getMetadata(LIMIT_KEY, proto.getStatus)).toBeUndefined();
    expect(Reflect.getMetadata(TTL_KEY, proto.getStatus)).toBeUndefined();
  });

  it.each(['sync', 'setWorkerSecret', 'provision'] as const)(
    'keeps the strict 10/min limit on %s',
    (name) => {
      expect(Reflect.getMetadata(LIMIT_KEY, proto[name])).toBe(10);
      expect(Reflect.getMetadata(TTL_KEY, proto[name])).toBe(60_000);
    },
  );
});
