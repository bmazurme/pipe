import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateColumnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;
}

export class UpdateColumnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;
}

export class CreateCardDto {
  @IsInt()
  @Min(1)
  columnId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;
}

export class UpdateCardDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class MoveCardDto {
  @IsInt()
  @Min(1)
  columnId: number;

  // Index in the target column the card should end up at.
  @IsInt()
  @Min(0)
  @Max(100000)
  position: number;
}

export class TaskCardResponseDto {
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TaskColumnResponseDto {
  id: number;
  title: string;
  position: number;
  cards: TaskCardResponseDto[];
}

export class TaskBoardResponseDto {
  columns: TaskColumnResponseDto[];
}
