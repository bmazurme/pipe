import { describe, expect, it } from 'vitest';

import { groupedServices, NAV_GROUP_ORDER, SERVICES, visibleServices } from './services';

describe('groupedServices', () => {
  it('lists the sections in the sidebar order, and every service in exactly one of them', () => {
    const sections = groupedServices(true);

    expect(sections.map((section) => section.group)).toEqual(NAV_GROUP_ORDER);
    expect(sections.flatMap((section) => section.items.map((item) => item.id)).sort()).toEqual(SERVICES.map((item) => item.id).sort());
  });

  it('keeps the order of the services inside a section', () => {
    for (const section of groupedServices(true)) {
      expect(section.items.map((item) => item.id)).toEqual(SERVICES.filter((item) => item.group === section.group).map((item) => item.id));
    }
  });

  it('gives every section a title', () => {
    for (const section of groupedServices(true)) expect(section.title.length).toBeGreaterThan(0);
  });

  it('drops the owner-only services for another account, and a section left empty with them', () => {
    const sections = groupedServices(false);

    expect(sections.flatMap((section) => section.items).every((item) => !item.ownerOnly)).toBe(true);
    expect(sections.flatMap((section) => section.items)).toHaveLength(visibleServices(false).length);
    expect(sections.every((section) => section.items.length > 0)).toBe(true);
  });
});
