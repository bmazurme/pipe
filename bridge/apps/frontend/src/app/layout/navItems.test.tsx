import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NAV_GROUP_ORDER, SERVICES } from '../../shared/config/services';
import { buildBurgerItems, buildMenuItems, NAV_ITEMS, navSections } from './navItems';

const navigate = vi.fn();
const ids = (items: { id: string; type?: string }[]) =>
  items.filter((item) => item.type !== 'divider').map((item) => item.id);

describe('the sidebar sections', () => {
  it('puts Home first, then the AI-agent pages, data, work tools and the operations pages last', () => {
    expect(ids(buildMenuItems('/', navigate)).filter((id) => id !== 'rag')).toEqual([
      'home',
      'worker',
      'chat',
      'improve',
      'context',
      'questions',
      'storage',
      'purge',
      'keys',
      'secrets',
      'time',
      'reports',
      'lab',
      'inbox',
      'usage',
      'dashboard',
      'boards',
      'vpn',
    ]);
  });

  it('separates the sections with dividers, and the announced pages with one more', () => {
    const items = buildMenuItems('/', navigate);
    const dividers = items.filter((item) => item.type === 'divider');

    // Home | agent | data | work | system | soon
    expect(dividers).toHaveLength(NAV_GROUP_ORDER.length + 1);
    expect(items[0].id).toBe('home');
    expect(items[1].type).toBe('divider');
    expect(items.at(-1)?.id).toBe('rag');
  });

  it('lists every service exactly once, whatever its section', () => {
    expect(NAV_ITEMS.map((item) => item.id).sort()).toEqual(['home', ...SERVICES.map((service) => service.id)].sort());
    expect(navSections().flat()).toHaveLength(SERVICES.length + 1);
  });

  it('the burger shows the same order and the same dividers', () => {
    expect(ids(buildBurgerItems('/', navigate))).toEqual(ids(buildMenuItems('/', navigate)));
    expect(buildBurgerItems('/', navigate).filter((item) => item.type === 'divider')).toHaveLength(
      NAV_GROUP_ORDER.length + 1,
    );
  });

  it('marks the current page, including a sub-route of it', () => {
    const current = (path: string) =>
      buildMenuItems(path, navigate)
        .filter((item) => item.current)
        .map((item) => item.id);

    expect(current('/')).toEqual(['home']);
    expect(current('/worker')).toEqual(['worker']);
    expect(current('/improve/anything')).toEqual(['improve']);
  });
});

describe('the worker status dot', () => {
  const adornment = (up: boolean | undefined) =>
    buildMenuItems('/', navigate, { workerUp: up }).find((item) => item.id === 'worker')?.rightAdornment;

  it('is drawn only on the worker row, and only once the state is known', () => {
    expect(adornment(undefined)).toBeUndefined();
    expect(buildMenuItems('/', navigate, { workerUp: true }).filter((item) => item.rightAdornment)).toHaveLength(1);
  });

  it('says in words whether worker answers', () => {
    const { rerender } = render(<>{adornment(true)}</>);

    expect(screen.getByRole('img', { name: 'Worker: на связи' })).toBeTruthy();

    rerender(<>{adornment(false)}</>);
    expect(screen.getByRole('img', { name: 'Worker: не отвечает' })).toBeTruthy();
  });

  it('is part of the worker title in the burger, which has no slot beside the title', () => {
    const title = buildBurgerItems('/', navigate, { workerUp: false }).find((item) => item.id === 'worker')?.title;

    render(<>{title}</>);
    expect(screen.getByText('Worker')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Worker: не отвечает' })).toBeTruthy();
  });
});

describe('the owner-only pages', () => {
  const ownerOnly = ['dashboard', 'improve', 'vpn'];

  it('are left out of the sidebar and the burger for an account that is not the owner', () => {
    for (const id of ownerOnly) {
      expect(ids(buildMenuItems('/', navigate, { isOwner: false }))).not.toContain(id);
      expect(ids(buildBurgerItems('/', navigate, { isOwner: false }))).not.toContain(id);
    }
    expect(ids(buildMenuItems('/', navigate, { isOwner: false }))).toContain('worker');
  });

  it('are listed for the owner', () => {
    for (const id of ownerOnly) {
      expect(ids(buildMenuItems('/', navigate, { isOwner: true }))).toContain(id);
      expect(ids(buildBurgerItems('/', navigate, { isOwner: true }))).toContain(id);
    }
  });

  it('lists Lab as a plain link, without the "скоро" tag, in the sidebar and in the burger', () => {
    const aside = buildMenuItems('/', navigate).find((item) => item.id === 'lab');
    const burger = buildBurgerItems('/', navigate).find((item) => item.id === 'lab');

    expect(aside).toMatchObject({ href: '/lab' });
    expect(render(<>{aside?.title}</>).container).toHaveTextContent('Lab');
    expect(screen.queryByText('скоро')).toBeNull();
    expect(burger?.onItemClick).toBeTypeOf('function');
  });
});

describe('the inbox count badge', () => {
  const adornment = (inboxTotal?: number, inboxUrgent?: number) =>
    buildMenuItems('/', navigate, { inboxTotal, inboxUrgent }).find((item) => item.id === 'inbox')?.rightAdornment;

  it('is drawn only while something waits', () => {
    expect(adornment(undefined)).toBeUndefined();
    expect(adornment(0, 0)).toBeUndefined();
    expect(buildMenuItems('/', navigate, { inboxTotal: 2 }).filter((item) => item.rightAdornment)).toHaveLength(1);
  });

  it('says in words how many wait and how many are urgent', () => {
    const { rerender } = render(<>{adornment(3, 1)}</>);

    const badge = screen.getByRole('img', { name: '3 ждут решения, 1 срочно' });
    expect(badge).toHaveTextContent('3');
    expect(badge.className).toContain('countBadgeUrgent');

    rerender(<>{adornment(2, 0)}</>);
    expect(screen.getByRole('img', { name: '2 ждут решения' }).className).not.toContain('countBadgeUrgent');
  });

  it('is part of the inbox title in the burger', () => {
    const title = buildBurgerItems('/', navigate, { inboxTotal: 3, inboxUrgent: 1 }).find(
      (item) => item.id === 'inbox',
    )?.title;

    render(<>{title}</>);
    expect(screen.getByRole('img', { name: '3 ждут решения, 1 срочно' })).toBeTruthy();
  });
});
