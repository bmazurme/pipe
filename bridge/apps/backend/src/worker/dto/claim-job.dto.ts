import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { WORKER_CAPABILITIES } from '../capabilities';

export class ClaimJobDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  workerName?: string;

  // Capabilities this worker has saved but cannot use right now (e.g. Fusion is closed): it is not handed jobs needing them.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(WORKER_CAPABILITIES, { each: true })
  unavailableCapabilities?: string[];
}
