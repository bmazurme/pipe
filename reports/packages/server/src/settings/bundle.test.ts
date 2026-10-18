import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SettingsBundleType } from '@reports/shared';

import { applySettingsBundle, buildSettingsBundle } from './bundle';
import { getSettings, setSettings } from './props';
import { getSubscriptionConfig, setSubscriptionConfig } from '../subscription/config-props';
import { getProjectDict, setProjectDict } from '../reports/project-dict-props';
import { addOffDays, getAllOffDaysByYear } from '../counts/props';

vi.mock('./props', () => ({ getSettings: vi.fn(), setSettings: vi.fn() }));
vi.mock('../subscription/config-props', () => ({
  getSubscriptionConfig: vi.fn(),
  setSubscriptionConfig: vi.fn(),
}));
vi.mock('../reports/project-dict-props', () => ({
  getProjectDict: vi.fn(),
  setProjectDict: vi.fn(),
}));
vi.mock('../counts/props', () => ({ addOffDays: vi.fn(), getAllOffDaysByYear: vi.fn() }));

const settings = { gitlabUrl: 'https://gitlab.com/api/v4' };
const subscriptionConfig = { projects: [] };

const makeBundle = (offDaysByYear: unknown): SettingsBundleType =>
  ({
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    settings,
    subscriptionConfig,
    projectDict: { a: 'b' },
    offDaysByYear,
  }) as unknown as SettingsBundleType;

const expectNothingWritten = () => {
  expect(setSettings).not.toHaveBeenCalled();
  expect(setSubscriptionConfig).not.toHaveBeenCalled();
  expect(setProjectDict).not.toHaveBeenCalled();
  expect(addOffDays).not.toHaveBeenCalled();
};

describe('applySettingsBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllOffDaysByYear).mockReturnValue({ '2026': [] });
  });

  it('applies all four parts and reports years missing locally', () => {
    const bundle = makeBundle({ '2026': ['2026-01-05'], '2020': ['2020-01-02'] });

    expect(applySettingsBundle(bundle)).toEqual({ skippedYears: ['2020'] });
    expect(setSettings).toHaveBeenCalledWith(settings);
    expect(setSubscriptionConfig).toHaveBeenCalledWith(subscriptionConfig);
    expect(setProjectDict).toHaveBeenCalledWith({ a: 'b' });
    expect(addOffDays).toHaveBeenCalledTimes(1);
    expect(addOffDays).toHaveBeenCalledWith('2026', ['2026-01-05']);
  });

  it.each([
    ['settings', { settings: undefined }],
    ['subscriptionConfig', { subscriptionConfig: undefined }],
  ])('throws and writes nothing when %s is missing', (_name, patch) => {
    const bundle = { ...makeBundle({}), ...patch } as unknown as SettingsBundleType;

    expect(() => applySettingsBundle(bundle)).toThrow('Файл не похож на экспорт');
    expectNothingWritten();
  });

  it.each([
    ['null', null],
    ['a string', '2026-01-05'],
  ])('rejects offDaysByYear with %s before any write', (_name, value) => {
    expect(() => applySettingsBundle(makeBundle({ '2026': value }))).toThrow();
    expectNothingWritten();
  });

  it('does not call addOffDays for an empty year', () => {
    expect(applySettingsBundle(makeBundle({ '2026': [] }))).toEqual({ skippedYears: [] });
    expect(addOffDays).not.toHaveBeenCalled();
  });

  it('round-trips a built bundle', () => {
    vi.mocked(getSettings).mockReturnValue(settings as never);
    vi.mocked(getSubscriptionConfig).mockReturnValue(subscriptionConfig as never);
    vi.mocked(getProjectDict).mockReturnValue({ a: 'b' } as never);
    vi.mocked(getAllOffDaysByYear).mockReturnValue({ '2026': ['2026-01-05'] });

    const bundle = buildSettingsBundle();

    expect(applySettingsBundle(bundle)).toEqual({ skippedYears: [] });
    expect(setSettings).toHaveBeenCalledWith(settings);
    expect(setSubscriptionConfig).toHaveBeenCalledWith(subscriptionConfig);
    expect(setProjectDict).toHaveBeenCalledWith({ a: 'b' });
    expect(addOffDays).toHaveBeenCalledWith('2026', ['2026-01-05']);
  });
});
