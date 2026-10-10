import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';

import {
  buildIssueArchive,
  extractIssue,
  extractIssueArchive,
  updateIssueFile,
  ISSUE_FILE_NAME,
} from './issuePack.js';

// The extraction cases themselves (subscription manifest, legacy fallback,
// assets, tampering) live in @pipe/protocol's issueParcel.test.ts — these only
// check that sync's builder and its extractIssueArchive re-export fit together.
describe('buildIssueArchive / extractIssueArchive', () => {
  const files = [
    { relPath: 'src/a.ts', content: 'export const a = 1;' },
    { relPath: 'src/nested/b.ts', content: 'export const b = 2;' },
  ];
  const manifest = {
    issueId: '1',
    issueIid: '42',
    issueTitle: 'Fix bug',
    issueDescription: 'Details',
    projectId: 173,
    branch: 'user-20260914-42',
    createdAt: '2026-09-14T10:00:00.000Z',
  };

  it('round-trips a parcel built by buildIssueArchive', () => {
    const { manifest: extracted, files: extractedFiles, legacyManifest } = extractIssueArchive(
      buildIssueArchive(files, manifest),
    );

    assert.equal(legacyManifest, false);
    assert.equal(extracted.issueIid, manifest.issueIid);
    assert.equal(extracted.branch, manifest.branch);
    assert.equal(extractedFiles.length, files.length);
  });

  it('rejects a tampered parcel', () => {
    const zip = new AdmZip(buildIssueArchive(files, manifest));
    zip.updateFile('src/a.ts', Buffer.from('export const a = 666;', 'utf-8'));

    assert.throws(() => extractIssueArchive(zip.toBuffer()), /contentHash mismatch/);
  });
});

describe('extractIssue', () => {
  const manifest = {
    issueId: '1',
    issueIid: '42',
    issueTitle: '{{SECRET}} is broken',
    issueDescription: 'See {{SECRET}} for details',
    projectId: 173,
    branch: 'user-20260914-42',
    createdAt: '2026-09-14T10:00:00.000Z',
    contentHash: 'deadbeef',
    schemaVersion: 1,
  };

  it('de-anonymizes title/description and writes ISSUE.md into the project', () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-issue-test-'));
    const dictionary = { 'real-value': '{{SECRET}}' };

    const result = extractIssue(projectPath, manifest, dictionary, 7);

    assert.equal(result.title, 'real-value is broken');
    assert.equal(result.description, 'See real-value for details');
    assert.equal(result.path, path.join(projectPath, ISSUE_FILE_NAME));

    const written = readFileSync(result.path, 'utf-8');
    assert.match(written, /^# Issue #42 \(project 173\)/);
    assert.match(written, /real-value is broken/);
    assert.match(written, /See real-value for details/);
    assert.match(written, /Branch: user-20260914-42/);
    assert.match(written, /parcel id 7/);
    assert.doesNotMatch(written, /## Images/);
  });

  it('writes assets to disk and lists them in ISSUE.md', () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-issue-assets-test-'));
    const pngBytes = Buffer.from([1, 2, 3, 4]);
    const assets = [{ relPath: 'issue-images/shot.png', base64: pngBytes.toString('base64') }];

    const result = extractIssue(projectPath, manifest, {}, 7, assets);

    assert.deepEqual(result.imagePaths, ['issue-images/shot.png']);
    const writtenImage = readFileSync(path.join(projectPath, 'issue-images/shot.png'));
    assert.deepEqual(writtenImage, pngBytes);

    const written = readFileSync(result.path, 'utf-8');
    assert.match(written, /## Images/);
    assert.match(written, /- issue-images\/shot\.png/);
  });

  it('updateIssueFile rewrites the title/description while keeping the branch footer and images', () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'sync-cli-issue-update-test-'));
    const result = extractIssue(projectPath, manifest, {}, 7, [
      { relPath: 'issue-images/shot.png', base64: Buffer.from([1]).toString('base64') },
    ]);

    updateIssueFile(result.path, manifest, 'Edited title', 'Edited description', result.imagePaths, 7);

    const written = readFileSync(result.path, 'utf-8');
    assert.match(written, /Edited title/);
    assert.match(written, /Edited description/);
    assert.match(written, /issue-images\/shot\.png/);
    assert.match(written, /Branch: user-20260914-42/);
    assert.equal(existsSync(path.join(projectPath, 'issue-images/shot.png')), true);
  });
});
