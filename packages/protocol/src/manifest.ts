// Bumped whenever a manifest field is added/removed/renamed in a way that an
// older reader can't safely interpret. See assertSchemaVersion below for what
// "safely" means in practice.
export const PROTOCOL_SCHEMA_VERSION = 1;

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

  if (manifest.schemaVersion > PROTOCOL_SCHEMA_VERSION) {
    throw new Error(
      `${entryName} is schemaVersion ${manifest.schemaVersion}, but this build of @pipe/protocol only ` +
        `understands up to ${PROTOCOL_SCHEMA_VERSION} — upgrade @pipe/protocol before reading this parcel.`,
    );
  }
}
