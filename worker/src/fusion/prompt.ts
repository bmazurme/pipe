// What the model is told when its job needs Fusion 360 (the worker's `fusion` capability): the tool, the way of working, the limits.
export function fusionInstructions(ctlPath: string): string {
  const ctl = `node ${JSON.stringify(ctlPath)}`;

  return [
    'This job runs on a Mac with Autodesk Fusion 360 open. You can build and check CAD models in it from your shell with the `fusionctl` tool:',
    '',
    `- \`${ctl} health\` — is Fusion reachable, which document is active;`,
    `- \`${ctl} info\` — the active design: bodies, components, bounding box, units;`,
    `- \`${ctl} run <script.py> [--timeout SEC]\` — runs a Python script INSIDE Fusion (the Fusion API: \`import adsk.core, adsk.fusion\`). Write it like a Fusion script: define \`run(context)\` and use \`adsk.core.Application.get()\`. Its prints and its traceback come back to you; a returned JSON-able value is shown as \`result:\`;`,
    `- \`${ctl} screenshot <out.png> [--view iso|front|back|top|bottom|left|right] [--size WxH]\` — a picture of the active viewport. Look at it (open the PNG) to check the model, do not guess;`,
    `- \`${ctl} export <step|stl|f3d|iges> <out-file>\` — export the active design.`,
    '',
    'How to work:',
    '- Keep the scripts in the repository (for example `cad/v1/…py`) so the result can be rerun; put exports and pictures next to them. Everything you leave in the working directory is returned as the result, binary files included.',
    '- Make the model parametric where the task allows it: named user parameters (`design.userParameters`), units in centimetres in the Fusion API (1 = 1 cm), one script per step so a failure is easy to locate.',
    '- Work in small steps: run a script, read its output, take a screenshot, fix what is wrong, repeat. A script that raised an error may have changed the design half-way — start the next script from a clean document (`app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)`) or undo explicitly.',
    '- Check dimensions with numbers (bounding box, volume, mass from `info` or your own script), not only by eye, and say in the final answer what you measured.',
    '- You cannot save to Fusion\'s cloud or open other people\'s documents; work with a new local document and export files instead.',
    '- If Fusion is not reachable (`fusionctl health` fails), stop and say so — do not pretend the model was built.',
  ].join('\n');
}

export function withFusion(prompt: string, ctlPath: string): string {
  return `${prompt}\n\n${fusionInstructions(ctlPath)}`;
}
