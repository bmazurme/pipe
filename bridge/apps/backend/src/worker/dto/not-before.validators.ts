import { registerDecorator } from 'class-validator';

function futureBound(
  name: string,
  message: string,
  check: (time: number, now: number) => boolean,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) =>
    registerDecorator({
      name,
      target: object.constructor,
      propertyName: String(propertyName),
      options: { message },
      validator: {
        validate: (value: unknown) =>
          value instanceof Date &&
          !Number.isNaN(value.getTime()) &&
          check(value.getTime(), Date.now()),
      },
    });
}

export const MinFutureDate = (): PropertyDecorator =>
  futureBound(
    'minFutureDate',
    'notBefore must be in the future',
    (time, now) => time > now,
  );

export const MaxFutureDate = (maxAheadMs: number): PropertyDecorator =>
  futureBound(
    'maxFutureDate',
    'notBefore must be at most 7 days ahead',
    (time, now) => time <= now + maxAheadMs,
  );
