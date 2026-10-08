import { PartialType } from '@nestjs/mapped-types';

import { CreateContextDto } from './create-context.dto';

export class UpdateContextDto extends PartialType(CreateContextDto) {}
