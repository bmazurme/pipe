import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, Toaster, ToasterProvider } from '@gravity-ui/uikit';
import type { SubscriptionIssueType } from '@reports/shared';

const reset = vi.fn();
const idle = () => [vi.fn(() => ({ unwrap: async () => ({}) })), { isLoading: false }] as const;

vi.mock('../../../store/api', () => ({
  useGetSubscriptionConfigQuery: () => ({ data: { commentTemplates: [] } }),
  useGetSubscriptionIssueTimeQuery: () => ({ data: undefined }),
  useInitSubscriptionIssueMutation: () => idle(),
  useLazyGetSubscriptionDraftQuery: () => [vi.fn(), { isFetching: false }],
  usePushSubscriptionIssueMutation: () => idle(),
  usePullSubscriptionIssueMutation: () => idle(),
  usePublishSubscriptionIssueMutation: () => idle(),
  useResetSubscriptionIssueMutation: () => [(...args: unknown[]) => ({ unwrap: async () => reset(...args) }), { isLoading: false }],
}));

import IssueStepper from './issue-stepper';

const issue = (step: 'init' | 'pushed' | 'pulled' | 'published'): SubscriptionIssueType => ({
  id: '1',
  iid: '6',
  projectId: 173,
  projectName: 'p',
  title: 'Fix it',
  description: 'd',
  webUrl: 'https://x',
  timeEstimate: '',
  state: 'opened',
  status: 'opened',
  tracked: true,
  subscription: { step, branch: 'task/173-6' },
});

const renderStepper = (step: 'init' | 'pushed' | 'pulled' | 'published') =>
  render(
    <ThemeProvider theme="light">
      <ToasterProvider toaster={new Toaster()}>
        <IssueStepper issue={issue(step)} />
      </ToasterProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  reset.mockReset().mockResolvedValue({ state: { step: 'init' }, stashed: true });
});

describe('IssueStepper: reset progress', () => {
  it('offers the reset only once the result has been received', () => {
    for (const step of ['init', 'pushed'] as const) {
      const { unmount } = renderStepper(step);

      expect(screen.queryByRole('button', { name: /Сбросить прогресс/ })).toBeNull();
      unmount();
    }
    for (const step of ['pulled', 'published'] as const) {
      const { unmount } = renderStepper(step);

      expect(screen.getByRole('button', { name: /Сбросить прогресс/ })).toBeInTheDocument();
      unmount();
    }
  });

  it('asks first, and by default puts the files of the result aside (in git stash), not deleting them', async () => {
    const user = userEvent.setup();
    renderStepper('pulled');

    await user.click(screen.getByRole('button', { name: /Сбросить прогресс/ }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('вернётся на шаг init');
    expect(dialog).toHaveTextContent('git stash pop');
    expect(reset).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Сбросить' }));

    await waitFor(() => expect(reset).toHaveBeenCalledWith({ projectId: 173, iid: '6', discardFiles: true }));
  });

  it('can leave the files in the working tree', async () => {
    const user = userEvent.setup();
    renderStepper('pulled');

    await user.click(screen.getByRole('button', { name: /Сбросить прогресс/ }));
    await user.click(await screen.findByRole('checkbox', { name: /Убрать полученные файлы/ }));
    await user.click(await screen.findByRole('button', { name: 'Сбросить' }));

    await waitFor(() => expect(reset).toHaveBeenCalledWith({ projectId: 173, iid: '6', discardFiles: false }));
  });

  it('says that a comment already published to GitLab stays there', async () => {
    const user = userEvent.setup();
    renderStepper('published');

    await user.click(screen.getByRole('button', { name: /Сбросить прогресс/ }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('останется там');
  });

  it('does not send anything when the person cancels', async () => {
    const user = userEvent.setup();
    renderStepper('pulled');

    await user.click(screen.getByRole('button', { name: /Сбросить прогресс/ }));
    await user.click(await screen.findByRole('button', { name: 'Отмена' }));

    expect(reset).not.toHaveBeenCalled();
  });
});
