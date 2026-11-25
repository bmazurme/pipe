export interface EnvEntry {
  name: string;
  value: string;
}

export interface ParsedEnvFile {
  entries: EnvEntry[];
  /** 1-based numbers of lines that could not be read as `KEY=value`. */
  invalidLines: number[];
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnvFile(text: string): ParsedEnvFile {
  const entries: EnvEntry[] = [];
  const invalidLines: number[] = [];

  text.split(/\r\n|\r|\n/).forEach((rawLine, index) => {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    if (/^export\s+/.test(line)) line = line.replace(/^export\s+/, '');

    const eq = line.indexOf('=');
    if (eq === -1) {
      invalidLines.push(index + 1);
      return;
    }
    const name = line.slice(0, eq).trim();
    const value = stripQuotes(line.slice(eq + 1).trim()).trim();
    if (!name || !value) {
      invalidLines.push(index + 1);
      return;
    }
    entries.push({ name, value });
  });

  return { entries, invalidLines };
}
