// Which pull requests a release contains. The repository merges by squash, so every PR is one commit on main whose subject ends with
// "(#1234)" — the subjects of the commits between the previously deployed release and this one are the list of what rolled out together.

const PR_SUFFIX = /\(#(\d{1,7})\)\s*$/;

export function prNumbersFromSubjects(subjects: string[]): number[] {
  const numbers = new Set<number>();

  for (const subject of subjects) {
    const firstLine = subject.split('\n', 1)[0];
    const match = PR_SUFFIX.exec(firstLine);

    if (match) numbers.add(Number(match[1]));
  }

  return [...numbers].sort((a, b) => a - b);
}

export function formatPrList(numbers: number[]): string {
  return numbers.length ? numbers.map((n) => `#${n}`).join(', ') : 'без PR';
}
