export interface KeyPair {
    publicKey: string;
    privateKey: string;
}
export declare function generateKeyPair(): KeyPair;
/**
 * Hybrid encryption: the parcel itself is encrypted with a random AES-256-GCM
 * key (asymmetric ciphers can't handle payloads this large), and only that
 * AES key is wrapped with the RSA-OAEP public key. Envelope layout:
 * [4 bytes BE encryptedKey length][encryptedKey][12 bytes iv][16 bytes authTag][ciphertext].
 * Shared by sync (push-issue/pull-issue) and reports (Subscription) so both
 * sides speak byte-identical envelopes.
 */
export declare function encryptBuffer(data: Buffer, publicKeyPem: string): Buffer;
export declare function decryptBuffer(envelope: Buffer, privateKeyPem: string): Buffer;
//# sourceMappingURL=encryption.d.ts.map