import { useDispatch, useSelector } from 'react-redux';
import type { TypedUseSelectorHook } from 'react-redux';

import type { AppDispatch, RootState } from './index';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/** True only once /users/me has said so: while it is unknown, owner-only sections behave as before. */
export const useIsNonOwner = (): boolean => useSelector((state: RootState) => state.users.user?.isOwner === false);
