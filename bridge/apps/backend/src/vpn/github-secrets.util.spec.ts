import sodium from 'libsodium-wrappers';

import { encryptSecretForGitHub } from './github-secrets.util';

async function keypairWithBase64PublicKey() {
  await sodium.ready;
  const keypair = sodium.crypto_box_keypair();
  const publicKeyBase64 = sodium.to_base64(
    keypair.publicKey,
    sodium.base64_variants.ORIGINAL,
  );
  return { keypair, publicKeyBase64 };
}

function open(
  encrypted: string,
  publicKey: Uint8Array,
  privateKey: Uint8Array,
) {
  const sealed = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
  return sodium.to_string(
    sodium.crypto_box_seal_open(sealed, publicKey, privateKey),
  );
}

describe('encryptSecretForGitHub', () => {
  it('produces a sealed box the matching keypair can open', async () => {
    const { keypair, publicKeyBase64 } = await keypairWithBase64PublicKey();

    const encrypted = await encryptSecretForGitHub(
      publicKeyBase64,
      's3cret-value/with+base64?chars',
    );

    expect(open(encrypted, keypair.publicKey, keypair.privateKey)).toBe(
      's3cret-value/with+base64?chars',
    );
  });

  it('does not contain the plaintext', async () => {
    const { publicKeyBase64 } = await keypairWithBase64PublicKey();
    const plaintext = 'plain-secret-value';

    const encrypted = await encryptSecretForGitHub(publicKeyBase64, plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(Buffer.from(encrypted, 'base64').toString('latin1')).not.toContain(
      plaintext,
    );
  });

  it('cannot be opened with a different keypair', async () => {
    const { publicKeyBase64 } = await keypairWithBase64PublicKey();
    const other = sodium.crypto_box_keypair();

    const encrypted = await encryptSecretForGitHub(publicKeyBase64, 'secret');

    expect(() => open(encrypted, other.publicKey, other.privateKey)).toThrow();
  });
});
