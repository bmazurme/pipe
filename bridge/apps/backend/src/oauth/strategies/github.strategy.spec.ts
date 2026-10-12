import { pickVerifiedEmail } from './github.strategy';

describe('pickVerifiedEmail', () => {
  it('takes the primary verified address', () => {
    expect(
      pickVerifiedEmail([
        { value: 'old@x.y', verified: true },
        { value: 'main@x.y', primary: true, verified: true },
      ]),
    ).toBe('main@x.y');
  });

  it('falls back to any verified address when the primary is not verified', () => {
    expect(
      pickVerifiedEmail([
        { value: 'main@x.y', primary: true, verified: false },
        { value: 'other@x.y', verified: true },
      ]),
    ).toBe('other@x.y');
  });

  it('never returns an unverified address', () => {
    expect(
      pickVerifiedEmail([
        { value: 'main@x.y', primary: true, verified: false },
      ]),
    ).toBeNull();
    expect(pickVerifiedEmail([{ value: 'main@x.y' }])).toBeNull();
    expect(pickVerifiedEmail(undefined)).toBeNull();
  });
});
