import { FusionClient } from './client.js';
import { readFusionConfig } from './config.js';
import { withFusion } from './prompt.js';

// What a job that requires Fusion 360 needs before the model starts: a model that has a shell (Claude), and a Fusion that answers.
export async function prepareFusionJob(
  prompt: string,
  options: {
    ctlPath: string;
    // Only Claude has a shell to run `fusionctl` in; gpt/deepseek/qwen do not.
    providerTool: 'claude' | 'openai';
    log: (text: string) => void;
    check?: () => Promise<{ document: string | null; version: string | null }>;
  },
): Promise<string> {
  if (options.providerTool !== 'claude') {
    throw new Error('A Fusion 360 job needs a Claude model (it works through a shell): choose Sonnet, Opus or Haiku');
  }

  const check =
    options.check ??
    (async () => {
      const health = await new FusionClient(readFusionConfig()).health();

      return { document: health.document, version: health.version };
    });
  const health = await check();

  options.log(`Fusion 360 is reachable${health.version ? ` (${health.version})` : ''}${health.document ? `, active document: ${health.document}` : ''}\n`);

  return withFusion(prompt, options.ctlPath);
}
