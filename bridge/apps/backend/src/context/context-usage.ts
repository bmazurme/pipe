import { Injectable } from '@nestjs/common';

export type ContextScheduleKind = 'improve' | 'lab';

export interface ContextScheduleUse {
  contextId: number;
  id: number;
  name: string;
  kind: ContextScheduleKind;
}

// A module that hands contexts to its runs answers from its own tables, so the
// Context module never reads another module's repositories. Either half is optional:
// a source that keeps schedules answers schedulesFor, one that launches jobs lastUseByName.
export interface ContextUsageSource {
  schedulesFor?(
    userId: number,
    contextIds: number[],
  ): Promise<ContextScheduleUse[]>;
  // Newest use per context name: jobs keep only a snapshot of the name, not the id.
  lastUseByName?(userId: number): Promise<Map<string, Date>>;
}

@Injectable()
export class ContextUsageRegistry {
  private readonly sources: ContextUsageSource[] = [];

  register(source: ContextUsageSource): void {
    this.sources.push(source);
  }

  async schedulesFor(
    userId: number,
    contextIds: number[],
  ): Promise<ContextScheduleUse[]> {
    const lists = await Promise.all(
      this.sources.map((source) =>
        source.schedulesFor ? source.schedulesFor(userId, contextIds) : [],
      ),
    );

    return lists.flat().sort((a, b) => a.name.localeCompare(b.name));
  }

  async lastUseByName(userId: number): Promise<Map<string, Date>> {
    const maps = await Promise.all(
      this.sources.map((source) =>
        source.lastUseByName
          ? source.lastUseByName(userId)
          : new Map<string, Date>(),
      ),
    );
    const merged = new Map<string, Date>();

    for (const map of maps) {
      for (const [name, at] of map) {
        const known = merged.get(name);
        if (!known || at > known) merged.set(name, at);
      }
    }

    return merged;
  }
}
