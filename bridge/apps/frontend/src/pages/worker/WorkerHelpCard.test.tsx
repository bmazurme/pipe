import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@gravity-ui/uikit';
import { describe, expect, it } from 'vitest';

import { WorkerHelpCard } from './WorkerHelpCard';
import { HELP_TOPICS } from './workerHelp';

const renderCard = () =>
  render(
    <ThemeProvider theme="light">
      <MemoryRouter>
        <WorkerHelpCard />
      </MemoryRouter>
    </ThemeProvider>,
  );

describe('WorkerHelpCard', () => {
  it('is collapsed until asked for', () => {
    renderCard();

    expect(screen.getByText('Справка: токены и ключи')).toBeTruthy();
    expect(screen.queryByText('Claude Code OAuth-токен')).toBeNull();
  });

  it('lists every credential the page takes and opens its steps', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Показать' }));

    for (const topic of HELP_TOPICS) expect(screen.getByText(topic.title)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Claude Code OAuth-токен/ }));

    expect(screen.getByText(/claude setup-token/)).toBeTruthy();
    expect(screen.getByText(/Куда вставить:/)).toBeTruthy();
  });

  it('links out to the provider and in to the app pages', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Показать' }));
    await user.click(screen.getByRole('button', { name: /OpenAI API Key/ }));
    const external = screen.getByRole('link', { name: /platform\.openai\.com\/api-keys/ });

    expect(external.getAttribute('href')).toBe('https://platform.openai.com/api-keys');
    expect(external.getAttribute('rel')).toContain('noreferrer');

    await user.click(screen.getByRole('button', { name: /Ключ доступа worker к bridge/ }));

    expect(screen.getByRole('link', { name: 'Профиль → API-ключи' }).getAttribute('href')).toBe('/profile');
  });
});

describe('help topics', () => {
  it('cover one topic per key field on the page, with steps and a destination', () => {
    const ids = HELP_TOPICS.map((topic) => topic.id);

    expect(ids).toEqual(expect.arrayContaining(['claude', 'openai', 'deepseek', 'qwen']));
    for (const topic of HELP_TOPICS) {
      expect(topic.steps.length).toBeGreaterThan(0);
      expect(topic.whereToPut.length).toBeGreaterThan(0);
    }
  });

  it('never contains a real-looking secret', () => {
    const text = JSON.stringify(HELP_TOPICS);

    expect(text).not.toMatch(/sk-ant-oat01-[A-Za-z0-9_-]{20,}/);
    expect(text).not.toMatch(/sk-proj-[A-Za-z0-9_-]{20,}/);
  });
});
