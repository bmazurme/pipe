// A single place sync's CLI output goes through — console.* itself stays
// the actual sink (stdout/stderr output is exactly what a CLI's users and
// scripts expect, nothing here captures/redirects it), but leveled so
// --verbose can control what shows without a separate flag per command.
let verboseEnabled = false;

export function setVerbose(value: boolean): void {
  verboseEnabled = value;
}

export const log = {
  // Only shown with --verbose — detail a script parsing stdout shouldn't
  // have to filter out by default.
  debug(...args: unknown[]): void {
    if (verboseEnabled) console.log(...args);
  },
  info(...args: unknown[]): void {
    console.log(...args);
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
  },
  error(...args: unknown[]): void {
    console.error(...args);
  },
};
