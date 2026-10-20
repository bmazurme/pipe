import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const polled: { connection: Array<number | undefined>; active: Array<number | undefined> } = {
  connection: [],
  active: [],
};
let connectionResult = { isError: false, isSuccess: false, isFetching: true, isLoading: true, data: undefined };
let activeResult = { isError: false, isSuccess: false, isFetching: true, isLoading: true, data: undefined };
const unfocusedFlags: Array<boolean | undefined> = [];

vi.mock('../store/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/api')>();
  return {
    ...actual,
    useGetVpnConnectionStatusQuery: (_id: number, options: { pollingInterval?: number; skipPollingIfUnfocused?: boolean }) => {
      polled.connection.push(options.pollingInterval);
      unfocusedFlags.push(options.skipPollingIfUnfocused);
      return connectionResult;
    },
    useGetVpnStatusQuery: (_arg: unknown, options: { pollingInterval?: number; skipPollingIfUnfocused?: boolean }) => {
      polled.active.push(options.pollingInterval);
      unfocusedFlags.push(options.skipPollingIfUnfocused);
      return activeResult;
    },
    useListVpnConnectionsQuery: () => ({
      isError: false,
      isLoading: false,
      data: [{ id: 2, name: 'spare', serverAddress: '203.0.113.9', isActive: false, createdAt: '2026-09-30T07:00:00.000Z' }],
    }),
    useGetDashboardNodesQuery: () => ({ isError: false, isLoading: false, data: { nodes: [] } }),
    useGetDashboardBackupsQuery: () => ({ isError: false, isLoading: false, data: { configured: false } }),
  };
});

import { DashboardPage } from './DashboardPage';

const last = (list: Array<number | undefined>) => list[list.length - 1];

beforeEach(() => {
  polled.connection = [];
  polled.active = [];
  unfocusedFlags.length = 0;
});

describe('DashboardPage VPN poll back-off', () => {
  it('polls a failing connection at 60 s and returns to 20 s after a success', () => {
    const { rerender } = render(<DashboardPage />);
    expect(last(polled.connection)).toBe(20_000);

    connectionResult = { isError: true, isSuccess: false, isFetching: false, isLoading: false, data: undefined };
    rerender(<DashboardPage />);
    rerender(<DashboardPage />);
    expect(last(polled.connection)).toBe(60_000);

    connectionResult = { isError: false, isSuccess: true, isFetching: false, isLoading: false, data: undefined };
    rerender(<DashboardPage />);
    rerender(<DashboardPage />);
    expect(last(polled.connection)).toBe(20_000);
  });

  it('backs off the active status query too and keeps skipPollingIfUnfocused on', () => {
    activeResult = { isError: true, isSuccess: false, isFetching: false, isLoading: false, data: undefined };
    const { rerender } = render(<DashboardPage />);
    rerender(<DashboardPage />);
    expect(last(polled.active)).toBe(60_000);
    expect(unfocusedFlags.every(Boolean)).toBe(true);
  });
});
