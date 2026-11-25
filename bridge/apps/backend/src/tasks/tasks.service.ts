import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import {
  CreateCardDto,
  MoveCardDto,
  TaskBoardResponseDto,
  TaskCardResponseDto,
  UpdateCardDto,
} from './dto/tasks.dto';
import { TaskCard } from './entities/task-card.entity';
import { TaskColumn } from './entities/task-column.entity';

function toCardDto(card: TaskCard): TaskCardResponseDto {
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    description: card.description,
    position: card.position,
    archivedAt: card.archivedAt,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskColumn)
    private readonly columns: Repository<TaskColumn>,
    @InjectRepository(TaskCard)
    private readonly cards: Repository<TaskCard>,
  ) {}

  async getBoard(userId: number): Promise<TaskBoardResponseDto> {
    const columns = await this.columns.find({
      where: { userId },
      order: { position: 'ASC', id: 'ASC' },
    });
    const cards = await this.cards.find({
      where: { userId, archivedAt: IsNull() },
      order: { position: 'ASC', id: 'ASC' },
    });

    return {
      columns: columns.map((column) => ({
        id: column.id,
        title: column.title,
        position: column.position,
        cards: cards.filter((c) => c.columnId === column.id).map(toCardDto),
      })),
    };
  }

  async listArchive(userId: number): Promise<TaskCardResponseDto[]> {
    const cards = await this.cards.find({
      where: { userId, archivedAt: Not(IsNull()) },
      order: { archivedAt: 'DESC', id: 'DESC' },
    });

    return cards.map(toCardDto);
  }

  async createColumn(userId: number, title: string) {
    const last = await this.columns.find({
      where: { userId },
      order: { position: 'DESC' },
      take: 1,
    });
    const column = await this.columns.save(
      this.columns.create({
        userId,
        title: title.trim(),
        position: last.length ? last[0].position + 1 : 0,
      }),
    );

    return {
      id: column.id,
      title: column.title,
      position: column.position,
      cards: [],
    };
  }

  async renameColumn(id: number, userId: number, title: string) {
    const column = await this.findColumn(id, userId);

    column.title = title.trim();
    await this.columns.save(column);

    return { id: column.id, title: column.title, position: column.position };
  }

  async deleteColumn(id: number, userId: number): Promise<void> {
    const column = await this.findColumn(id, userId);
    const active = await this.cards.count({
      where: { columnId: column.id, archivedAt: IsNull() },
    });

    if (active > 0) {
      throw new BadRequestException(
        'The column still has cards: move or archive them first',
      );
    }

    await this.columns.delete(column.id);
  }

  async createCard(
    userId: number,
    dto: CreateCardDto,
  ): Promise<TaskCardResponseDto> {
    const column = await this.findColumn(dto.columnId, userId);
    const card = await this.cards.save(
      this.cards.create({
        userId,
        columnId: column.id,
        title: dto.title.trim(),
        description: dto.description ?? '',
        position: await this.nextPosition(column.id),
        archivedAt: null,
      }),
    );

    return toCardDto(card);
  }

  async updateCard(
    id: number,
    userId: number,
    dto: UpdateCardDto,
  ): Promise<TaskCardResponseDto> {
    const card = await this.findCard(id, userId);

    if (dto.title !== undefined) card.title = dto.title.trim();
    if (dto.description !== undefined) card.description = dto.description;
    if (dto.archived === true && !card.archivedAt) {
      card.archivedAt = new Date();
    } else if (dto.archived === false && card.archivedAt) {
      // Restored to the bottom of its column.
      card.archivedAt = null;
      card.position = await this.nextPosition(card.columnId);
    }

    return toCardDto(await this.cards.save(card));
  }

  async deleteCard(id: number, userId: number): Promise<void> {
    const card = await this.findCard(id, userId);

    await this.cards.delete(card.id);
  }

  // Puts the card at `position` in the target column and renumbers it.
  async moveCard(
    id: number,
    userId: number,
    dto: MoveCardDto,
  ): Promise<TaskBoardResponseDto> {
    const card = await this.findCard(id, userId);

    if (card.archivedAt) {
      throw new BadRequestException('An archived card cannot be moved');
    }

    const target = await this.findColumn(dto.columnId, userId);
    const siblings = (
      await this.cards.find({
        where: { columnId: target.id, archivedAt: IsNull() },
        order: { position: 'ASC', id: 'ASC' },
      })
    ).filter((c) => c.id !== card.id);
    const index = Math.min(dto.position, siblings.length);

    card.columnId = target.id;
    siblings.splice(index, 0, card);
    siblings.forEach((c, i) => {
      c.position = i;
    });
    await this.cards.save(siblings);

    return this.getBoard(userId);
  }

  private async nextPosition(columnId: number): Promise<number> {
    const last = await this.cards.find({
      where: { columnId, archivedAt: IsNull() },
      order: { position: 'DESC' },
      take: 1,
    });

    return last.length ? last[0].position + 1 : 0;
  }

  private async findColumn(id: number, userId: number): Promise<TaskColumn> {
    const column = await this.columns.findOne({ where: { id, userId } });

    if (!column) throw new NotFoundException('Column not found');

    return column;
  }

  private async findCard(id: number, userId: number): Promise<TaskCard> {
    const card = await this.cards.findOne({ where: { id, userId } });

    if (!card) throw new NotFoundException('Card not found');

    return card;
  }
}
