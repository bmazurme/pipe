import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildIssueArchive,
  extractIssue,
  extractIssueArchive,
  updateIssueFile,
  ISSUE_FILE_NAME,
  SUBSCRIPTION_MANIFEST_ENTRY,
} from './issuePack.js';
import { buildArchive } from './pack.js';

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

  it('round-trips files and the manifest through a zip archive', () => {
    const buffer = buildIssueArchive(files, manifest);
    const { manifest: extracted, files: extractedFiles, legacyManifest } = extractIssueArchive(buffer);

    assert.equal(legacyManifest, false);
    assert.equal(extracted.issueId, manifest.issueId);
    assert.equal(extracted.issueIid, manifest.issueIid);
    assert.equal(extracted.issueTitle, manifest.issueTitle);
    assert.equal(extracted.issueDescription, manifest.issueDescription);
    assert.equal(extracted.projectId, manifest.projectId);
    assert.equal(extracted.branch, manifest.branch);
    assert.equal(typeof extracted.contentHash, 'string');
    assert.deepEqual(
      [...extractedFiles].sort((a, b) => a.relPath.localeCompare(b.relPath)),
      [...files].sort((a, b) => a.relPath.localeCompare(b.relPath)),
    );
  });

  it('uses the __subscription_manifest__.json entry name', () => {
    const buffer = buildIssueArchive(files, manifest);
    // buildIssueArchive doesn't expose the zip directly, but extractIssueArchive
    // failing to find SUBSCRIPTION_MANIFEST_ENTRY would fall back to the legacy
    // entry and report legacyManifest: true — this confirms it does not.
    const { legacyManifest } = extractIssueArchive(buffer);
    assert.equal(legacyManifest, false, `expected the ${SUBSCRIPTION_MANIFEST_ENTRY} entry to be found`);
  });

  it('falls back to the legacy __sync_manifest__.json entry with empty issue fields', () => {
    const { buffer } = buildArchive('some-project', files);
    const { manifest: extracted, files: extractedFiles, legacyManifest } = extractIssueArchive(buffer);

    assert.equal(legacyManifest, true);
    assert.equal(extracted.issueId, '');
    assert.equal(extracted.issueTitle, '');
    assert.equal(extracted.branch, '');
    assert.equal(typeof extracted.contentHash, 'string');
    assert.equal(extractedFiles.length, files.length);
  });

  it('throws when neither manifest entry is present', () => {
    assert.throws(() => extractIssueArchive(Buffer.from('not a zip')));
  });

  it('round-trips assets separately from files', () => {
    const assets = [{ relPath: 'issue-images/shot.png', base64: Buffer.from([1, 2, 3]).toString('base64') }];
    const buffer = buildIssueArchive(files, manifest, assets);
    const { files: extractedFiles, assets: extractedAssets } = extractIssueArchive(buffer);

    assert.equal(extractedFiles.length, files.length);
    assert.deepEqual(extractedAssets, assets);
  });

  it('extracts no assets from an archive built without any', () => {
    const buffer = buildIssueArchive(files, manifest);
    const { assets } = extractIssueArchive(buffer);

    assert.deepEqual(assets, []);
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
