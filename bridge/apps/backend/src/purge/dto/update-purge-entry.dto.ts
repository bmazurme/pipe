import { PartialType } from '@nestjs/mapped-types';

import { CreatePurgeEntryDto } from './create-purge-entry.dto';

export class UpdatePurgeEntryDto extends PartialType(CreatePurgeEntryDto) {}
