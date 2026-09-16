import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

// RTK Query mutation errors aren't plain strings — this pulls the friendly
// message out of a CUSTOM_ERROR (queryFn-raised) or falls back for anything
// else (network failure, a plain HTTP error with no usable body, ...).
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const fetchError = error as FetchBaseQueryError;
    if (fetchError.status === 'CUSTOM_ERROR' && typeof fetchError.error === 'string') {
      return fetchError.error;
    }
  }

  return fallback;
}
