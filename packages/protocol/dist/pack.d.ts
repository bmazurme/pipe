import { type BaseManifest } from './manifest.js';
export interface PackedFile {
    relPath: string;
    content: string;
}
export interface PackedAsset {
    relPath: string;
    base64: string;
}
export declare const ASSET_PREFIX = "__issue_assets__/";
export declare function contentHash(files: PackedFile[], assets?: PackedAsset[]): string;
export declare function buildArchive<M extends BaseManifest>(entryName: string, files: PackedFile[], manifestFields: Omit<M, 'schemaVersion' | 'contentHash'>, assets?: PackedAsset[]): {
    buffer: Buffer;
    manifest: M;
};
export declare function extractArchive<M extends BaseManifest>(buffer: Buffer, entryName: string): {
    files: PackedFile[];
    assets: PackedAsset[];
    manifest: M;
};
//# sourceMappingURL=pack.d.ts.map