import { BadRequestException } from '@nestjs/common';

export function parseUpdatedAfter(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;

  const value = new Date(raw);

  if (Number.isNaN(value.getTime())) {
    throw new BadRequestException('updatedAfter must be a valid date');
  }

  return value;
}
