import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { ENTITIES } from './entities';

const SRC_DIR = join(__dirname, '..');

function moduleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return moduleFiles(path);

    return entry.name.endsWith('.module.ts') ? [path] : [];
  });
}

// Class names inside every `TypeOrmModule.forFeature([...])` in src/**/*.module.ts.
function forFeatureEntities(): { file: string; entity: string }[] {
  return moduleFiles(SRC_DIR).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const lists = [
      ...source.matchAll(/TypeOrmModule\.forFeature\(\s*\[([^\]]*)\]/g),
    ];

    return lists.flatMap((match) =>
      match[1]
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((entity) => ({ file: file.slice(SRC_DIR.length + 1), entity })),
    );
  });
}

describe('ENTITIES', () => {
  it('finds forFeature entities to check', () => {
    expect(forFeatureEntities().length).toBeGreaterThan(0);
  });

  // Without autoLoadEntities, forFeature only creates a repository: an entity
  // missing from the root list boots fine and fails its first query.
  it('lists every entity registered through TypeOrmModule.forFeature', () => {
    const registered = new Set(ENTITIES.map((entity) => entity.name));
    const missing = forFeatureEntities().filter(
      ({ entity }) => !registered.has(entity),
    );

    expect(missing).toEqual([]);
  });

  it('includes Context and ChatAttachment', () => {
    const names = ENTITIES.map((entity) => entity.name);

    expect(names).toEqual(
      expect.arrayContaining(['Context', 'ChatAttachment']),
    );
  });

  it('has no duplicates', () => {
    expect(new Set(ENTITIES).size).toBe(ENTITIES.length);
  });
});
