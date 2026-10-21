import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { StartLabRunDto } from './lab.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  (
    await validate(
      plainToInstance(StartLabRunDto, {
        projectId: 1,
        task: 'Fix the test',
        model: 'sonnet',
        ...body,
      }),
    )
  ).map((error) => error.property);

describe('StartLabRunDto: the branch of a run', () => {
  it('takes no branch, or a well-formed one', async () => {
    expect(await errorsFor({})).toEqual([]);
    expect(await errorsFor({ baseBranch: ' release/1.4 ' })).toEqual([]);
  });

  it('rejects a malformed branch name', async () => {
    expect(await errorsFor({ baseBranch: 'a b' })).toEqual(['baseBranch']);
    expect(await errorsFor({ baseBranch: 'x~1' })).toEqual(['baseBranch']);
    expect(await errorsFor({ baseBranch: 'x'.repeat(101) })).toEqual([
      'baseBranch',
    ]);
  });
});
