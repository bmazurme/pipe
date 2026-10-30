import { formatPrList, prNumbersFromSubjects } from './deploy-prs';

describe('prNumbersFromSubjects', () => {
  it('takes the PR number a squash merge puts at the end of the subject, once, in order', () => {
    expect(
      prNumbersFromSubjects([
        'Worker: diagnose a failed job (#1043)',
        'Inbox: one page for what waits (#1042)\n\nbody mentions (#7)',
        'Bump vite from 6.4.4 to 6.4.5 in /bridge (#1039)',
        'Worker: diagnose a failed job (#1043)',
      ]),
    ).toEqual([1039, 1042, 1043]);
  });

  it('ignores a number in the middle, a commit with none, and an empty list', () => {
    expect(
      prNumbersFromSubjects(['Fix #12 in place', 'Plain commit', '']),
    ).toEqual([]);
    expect(prNumbersFromSubjects([])).toEqual([]);
  });

  it('writes the list for a message', () => {
    expect(formatPrList([3, 9])).toBe('#3, #9');
    expect(formatPrList([])).toBe('без PR');
  });
});
