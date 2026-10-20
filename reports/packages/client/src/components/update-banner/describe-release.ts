import type { ReleaseInfoType } from '@reports/shared';

// "версия 1.1.0, сборка bbbbbbbbbbbb", or that nothing is known about the build.
export const describeRelease = (release: ReleaseInfoType | null): string =>
  release ? `${release.version ? `версия ${release.version}, ` : ''}сборка ${release.shortId}` : 'версия неизвестна';
