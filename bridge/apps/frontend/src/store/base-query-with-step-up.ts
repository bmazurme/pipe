import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query';

import baseQuery from './base-query';
import { clearStepUpGrant, isStepUpRequired, requestStepUp } from './step-up';

// baseQuery plus the second-factor retry: a 403 STEP_UP_REQUIRED opens the code dialog and, once a grant is stored,
// the same request is sent again (now carrying it). Kept apart from the refresh-on-401 wrapper because auth-api, which
// must not depend on that one (see its own comment), also holds routes that need a code (the emergency key).
const baseQueryWithStepUp: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await baseQuery(args, api, extraOptions);

  if (!isStepUpRequired(result.error)) return result;

  // Whatever grant was sent was refused (expired, or from another session): drop it before asking again.
  clearStepUpGrant();

  if (!(await requestStepUp())) return result;

  return baseQuery(args, api, extraOptions);
};

export default baseQueryWithStepUp;
