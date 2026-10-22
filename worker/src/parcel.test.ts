import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildArchive } from '@pipe/protocol';

import {
  buildResultParcel,
  describeTask,
  extractParcel,
  SUBSCRIPTION_MANIFEST_ENTRY,
  SYNC_MANIFEST_ENTRY,
} from './parcel.js';

function buildSubscriptionParcel(): Buffer {
  const { buffer } = buildArchive(
    SUBSCRIPTION_MANIFEST_ENTRY,
    [{ relPath: 'src/index.ts', content: 'console.log("hi")' }],
    {
      issueId: '1',
      issueIid: '6',
      issueTitle: 'Fix the thing',
      issueDescription: 'It is broken',
      projectId: 402,
      branch: 'task/402-6',
      createdAt: '2026-09-30T00:00:00.000Z',
    },
  );
  return buffer;
}

function buildSyncParcel(): Buffer {
  const { buffer } = buildArchive(
    SYNC_MANIFEST_ENTRY,
    [{ relPath: 'src/index.ts', content: 'console.log("hi")' }],
    { project: 'demo', machine: 'laptop', createdAt: '2026-09-30T00:00:00.000Z' },
  );
  return buffer;
}

describe('extractParcel', () => {
  it('recognizes a subscription-shaped parcel', () => {
    const parcel = extractParcel(buildSubscriptionParcel());
    assert.equal(parcel.manifestEntry, SUBSCRIPTION_MANIFEST_ENTRY);
    assert.equal(parcel.manifest.issueTitle, 'Fix the thing');
    assert.equal(parcel.files.length, 1);
  });

  it('recognizes a sync (project-mode) shaped parcel', () => {
    const parcel = extractParcel(buildSyncParcel());
    assert.equal(parcel.manifestEntry, SYNC_MANIFEST_ENTRY);
    assert.equal(parcel.manifest.project, 'demo');
  });

  it('throws a clear error for a zip with neither manifest', () => {
    const { buffer } = buildArchive('__something_else__.json', [], {});
    assert.throws(() => extractParcel(buffer), /no recognized manifest/);
  });
});

function buildCommentedParcel(withImage: boolean): Buffer {
  const { buffer } = buildArchive(
    SUBSCRIPTION_MANIFEST_ENTRY,
    [{ relPath: 'src/index.ts', content: 'x' }],
    {
      issueId: '1',
      issueIid: '6',
      issueTitle: 'Fix the thing',
      issueDescription: 'It is broken',
      issueComments: [
        { author: 'Anna', createdAt: '2026-10-01T10:00:00Z', body: 'Only on the passport card' },
        { author: 'Boris', createdAt: '2026-10-02T10:00:00Z', body: 'Screenshot attached' },
      ],
      projectId: 402,
      branch: 'task/402-6',
      createdAt: '2026-09-30T00:00:00.000Z',
    },
    withImage ? [{ relPath: 'issue-images/shot.png', base64: 'AQID' }] : [],
  );
  return buffer;
}

function buildMigrationParcel(withImage = false): Buffer {
  const { buffer } = buildArchive(
    SUBSCRIPTION_MANIFEST_ENTRY,
    [
      { relPath: 'source/Orders/Order.cs', content: 'class Order {}' },
      { relPath: 'target/src/users.ts', content: 'export const users = 1;' },
    ],
    {
      issueId: 'm-1',
      issueIid: 'm-1',
      issueTitle: 'Миграция: модуль Orders',
      issueDescription: 'Перенести модуль Orders и актуализировать Users',
      projectId: 4000000001,
      branch: 'task/m-1',
      createdAt: '2026-10-20T00:00:00.000Z',
      migration: { name: 'CRM → Nest', sourceRoot: 'source/', targetRoot: 'target/' },
    },
    withImage ? [{ relPath: 'issue-images/shot.png', base64: 'AQID' }] : [],
  );
  return buffer;
}

describe('describeTask for a migration', () => {
  it('names the current repository as read-only, the target as where the work goes, and carries the person\'s text', () => {
    const prompt = describeTask(extractParcel(buildMigrationParcel()));

    assert.match(prompt, /^Migration task \(CRM → Nest\): Миграция: модуль Orders/);
    assert.match(prompt, /`source\/` is the CURRENT repository.*read-only/s);
    assert.match(prompt, /`target\/` is the repository the project is moving TO/);
    assert.match(prompt, /Перенести модуль Orders и актуализировать Users/);
    assert.match(prompt, /Change only files under target\//);
    assert.doesNotMatch(prompt, /issue-images/);
  });

  it('keeps the migration marker in the result parcel it builds, so reports knows what it is unpacking', () => {
    const parcel = extractParcel(buildMigrationParcel());
    const result = extractParcel(buildResultParcel(parcel, [{ relPath: 'target/src/orders.ts', content: 'x' }]));

    assert.deepEqual((result.manifest as unknown as { migration: unknown }).migration, { name: 'CRM → Nest', sourceRoot: 'source/', targetRoot: 'target/' });
  });

  it('points at attached images when there are some', () => {
    assert.match(describeTask(extractParcel(buildMigrationParcel(true))), /issue-images\//);
  });

  it('leaves the prompt of an ordinary task as it was', () => {
    const prompt = describeTask(extractParcel(buildSubscriptionParcel()));

    assert.doesNotMatch(prompt, /Migration task/);
    assert.match(prompt, /^Task \(GitLab issue\)/);
  });
});

describe('describeTask with comments', () => {
  it('puts the issue comments, oldest first, after the description', () => {
    const prompt = describeTask(extractParcel(buildCommentedParcel(false)));

    assert.match(prompt, /Comments on the issue, oldest first/);
    assert.ok(prompt.indexOf('Only on the passport card') < prompt.indexOf('Screenshot attached'));
    assert.ok(prompt.indexOf('It is broken') < prompt.indexOf('Only on the passport card'));
    assert.match(prompt, /--- Anna, 2026-10-01T10:00:00Z:/);
    assert.doesNotMatch(prompt, /issue-images/);
  });

  it('points at the images when the parcel carries some', () => {
    assert.match(describeTask(extractParcel(buildCommentedParcel(true))), /issue-images\//);
  });
});

describe('describeTask', () => {
  it('builds a prompt from a subscription parcel\'s issue title/description', () => {
    const parcel = extractParcel(buildSubscriptionParcel());
    const prompt = describeTask(parcel);
    assert.match(prompt, /Fix the thing/);
    assert.match(prompt, /It is broken/);
  });

  it('falls back to a generic prompt for a project-mode parcel with no issue text', () => {
    const parcel = extractParcel(buildSyncParcel());
    assert.match(describeTask(parcel), /No task description/);
  });
});

describe('buildResultParcel', () => {
  it('repacks edited files under the same manifest entry/shape', () => {
    const parcel = extractParcel(buildSubscriptionParcel());
    const resultBuffer = buildResultParcel(parcel, [
      { relPath: 'src/index.ts', content: 'console.log("fixed")' },
      { relPath: 'src/new-file.ts', content: 'export const x = 1;' },
    ]);

    const reExtracted = extractParcel(resultBuffer);
    assert.equal(reExtracted.manifestEntry, SUBSCRIPTION_MANIFEST_ENTRY);
    assert.equal(reExtracted.manifest.issueTitle, 'Fix the thing');
    assert.equal(reExtracted.files.length, 2);
    assert.ok(reExtracted.files.some((f) => f.relPath === 'src/new-file.ts'));
  });
});

describe('describeTask with files the person attached', () => {
  const parcelWith = (assets: { relPath: string; base64: string }[]): Buffer =>
    buildArchive(
      SUBSCRIPTION_MANIFEST_ENTRY,
      [{ relPath: 'src/index.ts', content: 'x' }],
      { issueId: '1', issueIid: '6', issueTitle: 'Read the mail', issueDescription: 'See the attachment', projectId: 402, branch: 'task/402-6', createdAt: '2026-10-22T00:00:00.000Z' },
      assets,
    ).buffer;

  it('points the model at issue-attachments/ and says they are input only', () => {
    const prompt = describeTask(extractParcel(parcelWith([{ relPath: 'issue-attachments/letter.msg', base64: Buffer.from('mail').toString('base64') }])));

    assert.match(prompt, /issue-attachments\/ folder/);
    assert.match(prompt, /input only/);
    assert.doesNotMatch(prompt, /issue-images/);
  });

  it('mentions neither folder when there is nothing attached, and both when both are', () => {
    assert.doesNotMatch(describeTask(extractParcel(parcelWith([]))), /issue-attachments|issue-images/);

    const both = describeTask(
      extractParcel(
        parcelWith([
          { relPath: 'issue-images/a.png', base64: Buffer.from('p').toString('base64') },
          { relPath: 'issue-attachments/data.json', base64: Buffer.from('{}').toString('base64') },
        ]),
      ),
    );

    assert.match(both, /issue-images\//);
    assert.match(both, /issue-attachments\//);
  });
});
