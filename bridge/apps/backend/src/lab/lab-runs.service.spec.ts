import { isBlocked, titleOf } from './lab-runs.service';
import { isValidRepo } from './lab-github';
import { toView } from './lab-projects.service';
import { LabProject } from './entities/lab-project.entity';

describe('Lab helpers', () => {
  it('takes the first line of a task as its title and cuts a long one', () => {
    expect(titleOf('  Обновить README\nи тесты')).toBe('Обновить README');
    expect(titleOf('x'.repeat(200))).toHaveLength(80);
  });

  it('never lets a run change CI definitions or git internals', () => {
    expect(isBlocked('.github/workflows/ci.yml')).toBe(true);
    expect(isBlocked('.git/config')).toBe(true);
    expect(isBlocked('src/.github/workflows/x.yml')).toBe(false);
    expect(isBlocked('README.md')).toBe(false);
  });

  it('accepts owner/name only', () => {
    expect(isValidRepo('bmazurme/pipe')).toBe(true);
    expect(isValidRepo('pipe')).toBe(false);
    expect(isValidRepo('a/b/c')).toBe(false);
    expect(isValidRepo('a/..')).toBe(false);
  });

  it('never exposes the token of a project', () => {
    const view = toView({
      id: 1,
      name: 'p',
      token: 'ghp_secret',
      tokenHint: 'cret',
    } as LabProject);

    expect(view).not.toHaveProperty('token');
    expect(view.tokenHint).toBe('cret');
  });
});
