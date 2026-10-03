import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import { log } from './log.js';

export interface ReviewInput {
  title: string;
  description: string;
  imagePaths: string[];
}

export interface ReviewResult {
  title: string;
  description: string;
  model?: string;
  proceed: boolean;
}

const MODEL_CHOICES = ['default', 'sonnet', 'opus', 'fable'];

function editorCommand(): string {
  if (process.env.VISUAL) return process.env.VISUAL;
  if (process.env.EDITOR) return process.env.EDITOR;
  return process.platform === 'win32' ? 'notepad' : 'nano';
}

// Opens the user's own editor on a small "<title>\n\n<description>" scratch
// file rather than trying to build a multiline prompt in the terminal itself
// — gives real editing (undo, syntax awareness, whatever the user is already
// used to) for what's otherwise plain free-form text.
function editText(title: string, description: string): { title: string; description: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-cli-review-'));
  const file = path.join(dir, 'issue.md');
  writeFileSync(file, `${title}\n\n${description}\n`, 'utf-8');

  // $EDITOR conventionally may carry flags (e.g. "code --wait") — split on
  // whitespace rather than treating the whole string as one executable name.
  const [editorBin, ...editorArgs] = editorCommand().split(' ').filter(Boolean);
  const result = spawnSync(editorBin, [...editorArgs, file], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || (result.status ?? 0) !== 0) {
    log.warn('Editor exited without saving cleanly — keeping the text as it was.');
    rmSync(dir, { recursive: true, force: true });
    return { title, description };
  }

  const edited = readFileSync(file, 'utf-8');
  rmSync(dir, { recursive: true, force: true });

  const [editedTitle, ...rest] = edited.split('\n');
  // The blank line after the title is the file's own formatting, not content.
  const editedDescription = rest.join('\n').replace(/^\n/, '').trimEnd();

  return { title: editedTitle.trim(), description: editedDescription };
}

export interface ReviewIO {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export async function reviewIssueBeforeDispatch(
  issue: ReviewInput,
  io: ReviewIO = { input: process.stdin, output: process.stdout },
): Promise<ReviewResult> {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  const log = (line: string) => io.output.write(`${line}\n`);

  try {
    log('\n--- Issue review ---');
    log(`Title: ${issue.title}`);
    log('');
    log(issue.description || '(no description)');
    if (issue.imagePaths.length > 0) {
      log('');
      log('Images:');
      for (const imagePath of issue.imagePaths) log(`  - ${imagePath}`);
    }
    log('---\n');

    let title = issue.title;
    let description = issue.description;

    const editAnswer = (await rl.question('Edit description before dispatch? [y/N] ')).trim().toLowerCase();
    if (editAnswer === 'y' || editAnswer === 'yes') {
      ({ title, description } = editText(title, description));
    }

    const modelAnswer = (
      await rl.question(`Model to run this task with? [${MODEL_CHOICES.join('/')}] (default) `)
    )
      .trim()
      .toLowerCase();
    const model = !modelAnswer || modelAnswer === 'default' ? undefined : modelAnswer;

    const confirmAnswer = (await rl.question('Proceed with agent run? [Y/n] ')).trim().toLowerCase();
    const proceed = confirmAnswer === '' || confirmAnswer === 'y' || confirmAnswer === 'yes';

    return { title, description, model, proceed };
  } finally {
    rl.close();
  }
}
