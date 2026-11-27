import { configureCors } from './cors.config';

describe('configureCors', () => {
  const enable = (origins: string) => {
    const enableCors = jest.fn();
    const app = {
      get: () => ({ get: () => origins }),
      enableCors,
    };

    configureCors(app as never);

    return enableCors.mock.calls[0][0];
  };

  it('lets the browser send the second-factor grant header', () => {
    expect(enable('http://localhost:5173').allowedHeaders).toContain(
      'X-Step-Up',
    );
  });

  it('allows only the listed origins, none when the list is empty', () => {
    expect(enable('http://a.test, http://b.test').origin).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
    expect(enable('').origin).toBe(false);
  });
});
