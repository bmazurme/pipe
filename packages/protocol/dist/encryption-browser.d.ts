export declare function importRsaPublicKey(publicKeyPem: string): Promise<CryptoKey>;
export declare function importRsaPrivateKey(privateKeyPem: string): Promise<CryptoKey>;
export declare function encryptBuffer(data: Uint8Array, publicKeyPem: string): Promise<Uint8Array>;
export declare function decryptBuffer(envelope: Uint8Array, privateKeyPem: string): Promise<Uint8Array>;
//# sourceMappingURL=encryption-browser.d.ts.map