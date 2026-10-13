import type { BaseManifest } from './manifest.js';
import { type PackedAsset, type PackedFile } from './pack.js';
export declare const SUBSCRIPTION_MANIFEST_ENTRY = "__subscription_manifest__.json";
export declare const SYNC_MANIFEST_ENTRY = "__sync_manifest__.json";
export interface SubscriptionManifest extends BaseManifest {
    issueId: string;
    issueIid: string;
    issueTitle: string;
    issueDescription: string;
    projectId: number;
    branch: string;
    createdAt: string;
}
export declare function extractSubscriptionArchive(buffer: Buffer): {
    manifest: SubscriptionManifest;
    files: PackedFile[];
    assets: PackedAsset[];
    legacyManifest: boolean;
};
//# sourceMappingURL=issueParcel.d.ts.map