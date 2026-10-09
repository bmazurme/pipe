import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

// `ParseIntPipe` accepts any integer, so `year=-5` or `month=99` used to travel into a
// date string and fail inside Postgres as a 500. A request with a value outside what the
// calendar can hold is the client's mistake, and says so with a 400.
@Injectable()
export class ParseBoundedIntPipe implements PipeTransform<string, number> {
  constructor(
    private readonly name: string,
    private readonly min: number,
    private readonly max: number,
  ) {}

  transform(value: string): number {
    const parsed = Number(value);

    if (
      typeof value !== 'string' ||
      !/^-?\d+$/.test(value.trim()) ||
      !Number.isInteger(parsed) ||
      parsed < this.min ||
      parsed > this.max
    ) {
      throw new BadRequestException(
        `${this.name} must be an integer from ${this.min} to ${this.max}`,
      );
    }

    return parsed;
  }
}

export const YEAR_MIN = 1900;
export const YEAR_MAX = 2200;
export const yearPipe = () =>
  new ParseBoundedIntPipe('year', YEAR_MIN, YEAR_MAX);
export const monthPipe = () => new ParseBoundedIntPipe('month', 1, 12);
