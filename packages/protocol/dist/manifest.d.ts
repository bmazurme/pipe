export declare const PROTOCOL_SCHEMA_VERSION = 2;
export interface BaseManifest {
    schemaVersion: number;
    contentHash: string;
}
export declare function assertSchemaVersion(manifest: BaseManifest, entryName: string): void;
//# sourceMappingURL=manifest.d.ts.map