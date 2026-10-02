import sodium from 'libsodium-wrappers';

// GitHub Actions secrets are set by encrypting the plaintext with the repo's
// own public key (libsodium sealed box) — the API only ever accepts
// ciphertext, never plaintext, and there is no corresponding "read" endpoint
// (secrets are genuinely write-only, by design).
export async function encryptSecretForGitHub(
  publicKeyBase64: string,
  value: string,
): Promise<string> {
  await sodium.ready;

  const publicKey = sodium.from_base64(
    publicKeyBase64,
    sodium.base64_variants.ORIGINAL,
  );
  const message = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(message, publicKey);

  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}
