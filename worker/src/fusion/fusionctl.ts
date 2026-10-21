#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  FUSION_EXPORT_FORMATS,
  FUSION_VIEWS,
  FusionAddinError,
  FusionClient,
  type FusionExportFormat,
  type FusionView,
} from './client.js';
import { FusionNotConfiguredError, readFusionConfig } from './config.js';

// `fusionctl` — what the model uses, from its shell, to work in the Fusion 360 that is open on this Mac. It is a thin wrapper over the
// pipe add-in: run a Python script inside Fusion, look at the model (a picture), export it (STEP/STL/F3D/IGES).
//
//   fusionctl health
//   fusionctl info
//   fusionctl run <script.py> [--timeout SEC]
//   fusionctl screenshot <out.png> [--view iso|front|back|top|bottom|left|right] [--size WxH]
//   fusionctl export <step|stl|f3d|iges> <out-file>
//
// Exit status: 0 = done, 1 = the script failed (its output and traceback are printed), 2 = bad usage, 3 = Fusion could not be reached.

export interface FusionCtlDeps {
  client: () => FusionClient;
  readFile: (file: string) => string;
  writeFile: (file: string, data: Buffer) => void;
  out: (text: string) => void;
  err: (text: string) => void;
}

export const USAGE = `usage:
  fusionctl health
  fusionctl info
  fusionctl run <script.py> [--timeout SEC]
  fusionctl screenshot <out.png> [--view ${FUSION_VIEWS.join('|')}] [--size WxH]
  fusionctl export <${FUSION_EXPORT_FORMATS.join('|')}> <out-file>`;

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) return undefined;

  const value = args[index + 1];

  args.splice(index, value === undefined ? 1 : 2);

  return value;
}

export async function runFusionCtl(argv: string[], deps: FusionCtlDeps): Promise<number> {
  const args = [...argv];
  const command = args.shift();

  try {
    switch (command) {
      case 'health': {
        deps.out(JSON.stringify(await deps.client().health(), null, 2));

        return 0;
      }
      case 'info': {
        deps.out(JSON.stringify(await deps.client().info(), null, 2));

        return 0;
      }
      case 'run': {
        const timeout = takeOption(args, '--timeout');
        const file = args[0];
        const seconds = timeout === undefined ? 120 : Number(timeout);

        if (!file || !Number.isFinite(seconds) || seconds < 1 || seconds > 1800) {
          deps.err(USAGE);

          return 2;
        }

        const result = await deps.client().run(deps.readFile(file), path.basename(file), seconds);

        if (result.stdout) deps.out(result.stdout.replace(/\n$/, ''));
        if (result.stderr) deps.err(result.stderr.replace(/\n$/, ''));
        if (result.result !== null && result.result !== undefined) deps.out(`result: ${JSON.stringify(result.result)}`);
        if (!result.ok) {
          deps.err(`FAILED: ${result.error ?? 'the script raised an exception'}`);
          if (result.traceback) deps.err(result.traceback.replace(/\n$/, ''));

          return 1;
        }

        deps.out('OK');

        return 0;
      }
      case 'screenshot': {
        const view = (takeOption(args, '--view') ?? 'iso') as FusionView;
        const size = takeOption(args, '--size') ?? '1600x1000';
        const match = /^(\d{2,5})x(\d{2,5})$/.exec(size);
        const out = args[0];

        if (!out || !FUSION_VIEWS.includes(view) || !match) {
          deps.err(USAGE);

          return 2;
        }

        deps.writeFile(out, await deps.client().screenshot(view, Number(match[1]), Number(match[2])));
        deps.out(`saved ${out} (${view} view)`);

        return 0;
      }
      case 'export': {
        const format = args[0] as FusionExportFormat | undefined;
        const out = args[1];

        if (!format || !out || !FUSION_EXPORT_FORMATS.includes(format)) {
          deps.err(USAGE);

          return 2;
        }

        deps.writeFile(out, await deps.client().export(format));
        deps.out(`saved ${out} (${format})`);

        return 0;
      }
      default:
        deps.err(USAGE);

        return 2;
    }
  } catch (error) {
    if (error instanceof FusionNotConfiguredError || error instanceof FusionAddinError) {
      deps.err(`Fusion 360 is not reachable: ${error.message}`);

      return 3;
    }

    deps.err(`fusionctl: ${error instanceof Error ? error.message : String(error)}`);

    return 3;
  }
}

export const realDeps: FusionCtlDeps = {
  client: () => new FusionClient(readFusionConfig()),
  readFile: (file) => readFileSync(file, 'utf8'),
  writeFile: (file, data) => {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    writeFileSync(file, data);
  },
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

// Run as a program, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runFusionCtl(process.argv.slice(2), realDeps).then((code) => process.exit(code));
}
