import { describe, expect, it } from 'vitest';

import { filterDestinations, isQuickSwitchChord } from './destinationFilter';

const ITEMS = [
  { id: 'home', title: 'Главная', description: 'Все сервисы', path: '/' },
  { id: 'worker', title: 'Worker', description: 'Задачи для Claude и состояние воркеров', path: '/worker' },
  { id: 'dashboard', title: 'Дашборд', description: 'Состояние инфраструктуры', path: '/dashboard' },
  { id: 'vpn', title: 'VPN', description: 'Подключения и каналы', path: '/vpn' },
  { id: 'inbox', title: 'Решения', description: 'Всё, что ждёт решения по воркерам', path: '/inbox' },
];

describe('filterDestinations', () => {
  it('lists everything in the sidebar order for an empty query', () => {
    expect(filterDestinations(ITEMS, '  ')).toEqual(ITEMS);
  });

  it('finds by the start of a title, ignoring case', () => {
    expect(filterDestinations(ITEMS, 'даш').map((item) => item.id)).toEqual(['dashboard']);
    expect(filterDestinations(ITEMS, 'VPN').map((item) => item.id)).toEqual(['vpn']);
  });

  it('puts a title match before a description match', () => {
    // «воркер»: the Worker page (title is English, but its description says it) and Решения (description only) — a title hit would win if there was one.
    expect(filterDestinations(ITEMS, 'воркер').map((item) => item.id)).toEqual(['worker', 'inbox']);
    expect(filterDestinations(ITEMS, 'решени').map((item) => item.id)[0]).toBe('inbox');
  });

  it('does not match the middle of a word of a description', () => {
    // «да» is inside «Задачи» and «Состояние инфраструктуры» no — only the Dashboard starts with it.
    expect(filterDestinations(ITEMS, 'да').map((item) => item.id)).toEqual(['dashboard']);
    expect(filterDestinations(ITEMS, 'ачи')).toEqual([]);
  });

  it('needs every word, and does not tell «е» from «ё»', () => {
    expect(filterDestinations(ITEMS, 'задачи claude').map((item) => item.id)).toEqual(['worker']);
    expect(filterDestinations(ITEMS, 'задачи nothing')).toEqual([]);
    expect(filterDestinations([{ id: 'x', title: 'Всё', description: '', path: '/x' }], 'все')).toHaveLength(1);
  });
});

describe('isQuickSwitchChord', () => {
  const chord = (key: string, over: object = {}) => isQuickSwitchChord({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

  it('is Ctrl+K or ⌘+K and nothing else', () => {
    expect(chord('k', { ctrlKey: true })).toBe(true);
    expect(chord('K', { metaKey: true })).toBe(true);
    expect(chord('k')).toBe(false);
    expect(chord('k', { ctrlKey: true, shiftKey: true })).toBe(false);
    expect(chord('k', { ctrlKey: true, altKey: true })).toBe(false);
    expect(chord('l', { ctrlKey: true })).toBe(false);
  });
});
