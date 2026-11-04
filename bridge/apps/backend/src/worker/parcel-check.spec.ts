import { BadRequestException } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';

import { assertRunnableParcel } from './parcel-check';

describe('assertRunnableParcel', () => {
  it('rejects data that is not a zip', () => {
    expect(() => assertRunnableParcel(strToU8('hello'))).toThrow(
      new BadRequestException('Посылка не является zip-архивом'),
    );
  });

  it('rejects a zip without a manifest', () => {
    const bytes = zipSync({ 'a.txt': strToU8('x') });
    expect(() => assertRunnableParcel(bytes)).toThrow(/нет манифеста/);
  });

  it.each(['__sync_manifest__.json', '__subscription_manifest__.json'])(
    'accepts a zip with %s',
    (manifest) => {
      const bytes = zipSync({ [manifest]: strToU8('{}') });
      expect(() => assertRunnableParcel(bytes)).not.toThrow();
    },
  );
});
