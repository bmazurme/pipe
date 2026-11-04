import { BadRequestException } from '@nestjs/common';
import { unzipSync } from 'fflate';

// Mirrors packages/protocol/src/issueParcel.ts (SUBSCRIPTION_MANIFEST_ENTRY / SYNC_MANIFEST_ENTRY);
// the backend does not depend on @pipe/protocol.
const MANIFEST_ENTRIES = [
  '__subscription_manifest__.json',
  '__sync_manifest__.json',
];

// A job on a file worker cannot read would only fail minutes later, after a worker slot is spent.
// The filter lists the entries without inflating any of them.
export function assertRunnableParcel(bytes: Uint8Array): void {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    throw new BadRequestException('Посылка не является zip-архивом');
  }
  if (!MANIFEST_ENTRIES.some((m) => names.includes(m))) {
    throw new BadRequestException(
      `В посылке нет манифеста (ожидается ${MANIFEST_ENTRIES.join(' или ')})`,
    );
  }
}
