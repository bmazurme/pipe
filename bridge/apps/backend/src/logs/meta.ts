// undefined for a null or unparseable stored value, so callers can tell
// "no usable meta" apart from a genuine empty object.
export function tryParseMeta(meta: string | null): unknown {
  if (!meta) return undefined;

  try {
    return JSON.parse(meta) as unknown;
  } catch {
    return undefined;
  }
}
