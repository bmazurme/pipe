import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../base.entity';

// One chunk of one markdown file of a Lab project's own repository, kept so "Спросить" can rank them against a
// question without re-downloading and re-chunking the repo on every query. Replaced wholesale on reindex
// (LabKnowledgeService.reindex) — never partially updated, since a repo's own docs are small enough that
// re-chunking everything is simpler and cheap enough compared to tracking which file changed.
@Entity({ name: 'lab_document_chunks' })
@Index(['projectId'])
export class LabDocumentChunk extends BaseEntity {
  @Column({ type: 'int', unsigned: true })
  projectId: number;

  // Path within the repository, e.g. "DECISIONS.md" or "calc/stage1_concept.md".
  @Column({ type: 'varchar', length: 500 })
  path: string;

  // The nearest markdown heading above this chunk, or null before the first heading in the file.
  @Column({ type: 'varchar', length: 300, nullable: true })
  heading: string | null;

  // Position of this chunk within its file (0-based) — several chunks can share one heading (a long section).
  @Column({ type: 'int', unsigned: true })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;
}
