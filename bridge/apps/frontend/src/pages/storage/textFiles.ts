// Shared between projectZip.ts (applies the Purge dictionary to a project
// folder before zipping) and the plain-file upload path (scans for leftover
// secrets before upload) — both need the same idea of "is this worth reading
// as text at all", so it lives in one place instead of two copies drifting.
export const TEXT_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts',
  'json', 'md', 'mdx', 'txt', 'css', 'scss', 'less',
  'html', 'htm', 'xml', 'svg', 'yml', 'yaml', 'graphql', 'gql',
  'vue', 'sql', 'sh',
]);

export function isTextFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
