// The RSA-OAEP+AES-256-GCM envelope now lives in @pipe/protocol, shared
// byte-for-byte with reports' Subscription module. Re-exported here so
// existing imports (`from './encryption.js'`) don't need to change.
export { generateKeyPair, encryptBuffer, decryptBuffer, type KeyPair } from '@pipe/protocol';
