// Bumped whenever a manifest field is added/removed/renamed in a way that an
// older reader can't safely interpret. See assertSchemaVersion below for what
// "safely" means in practice.
//
// v2: archives may carry binary `assets` (e.g. images extracted from a
// GitLab issue description) alongside the usual text `files` — see pack.ts.
// A v1 reader has no code path for the `__issue_assets__/` zip prefix those
// live under, so it's a real, if additive, format change.
export const PROTOCOL_SCHEMA_VERSION = 2;

export interface BaseManifest {
  schemaVersion: number;
  contentHash: string;
}

// A parcel built before schemaVersion existed has no field to check — that's
// expected for anything already sitting in bridge storage or a local
// .agent-work directory at the time this shipped, so it only warns. The
// failure this actually guards against is the opposite direction: a parcel
// stamped with a schemaVersion newer than this build understands, which would
// otherwise be silently misread instead of rejected with an actionable error.
export function assertSchemaVersion(manifest: BaseManifest, entryName: string): void {
  if (manifest.schemaVersion === undefined) {
    console.warn(
      `Warning: ${entryName} has no schemaVersion (built before parcel versioning existed) — reading it as schemaVersion 0.`,
    );
    return;
  }

  // Manifests come from untrusted JSON, so the declared type can't be trusted:
  // null, strings and NaN all make the `>` comparison below false and would
  // otherwise slip past the newer-than-understood check.
  const version: unknown = manifest.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new Error(`${entryName} has an invalid schemaVersion (${JSON.stringify(version)})`);
  }

  if (manifest.schemaVersion > PROTOCOL_SCHEMA_VERSION) {
    throw new Error(
      `${entryName} is schemaVersion ${manifest.schemaVersion}, but this build of @pipe/protocol only ` +
        `understands up to ${PROTOCOL_SCHEMA_VERSION} — upgrade @pipe/protocol before reading this parcel.`,
    );
  }
}
