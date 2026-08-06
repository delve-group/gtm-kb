import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ENCRYPTION_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function parseEncryptionKey(encodedKey: string): Buffer {
  const trimmed = encodedKey.trim();
  let key: Buffer;

  if (trimmed.startsWith('hex:')) {
    key = Buffer.from(trimmed.slice(4), 'hex');
  } else if (trimmed.startsWith('base64:')) {
    key = Buffer.from(trimmed.slice(7), 'base64');
  } else if (/^[a-f\d]{64}$/i.test(trimmed)) {
    key = Buffer.from(trimmed, 'hex');
  } else {
    key = Buffer.from(trimmed, 'base64url');
  }

  if (key.length !== 32) {
    key.fill(0);
    throw new TypeError(
      'SESSION_ENCRYPTION_KEY must be a base64/base64url-encoded 32-byte key or 64 hex characters.',
    );
  }
  return key;
}

export class CredentialCipher {
  readonly #key: Buffer;

  constructor(encodedKey: string) {
    this.#key = parseEncryptionKey(encodedKey);
  }

  encryptString(plaintext: string, additionalAuthenticatedData: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(additionalAuthenticatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      ENCRYPTION_VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decryptString(envelope: string, additionalAuthenticatedData: string): string {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = envelope.split('.');
    if (
      version !== ENCRYPTION_VERSION ||
      encodedIv === undefined ||
      encodedTag === undefined ||
      encodedCiphertext === undefined ||
      extra !== undefined
    ) {
      throw new Error('Encrypted credential payload is malformed.');
    }

    const iv = Buffer.from(encodedIv, 'base64url');
    const authTag = Buffer.from(encodedTag, 'base64url');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error('Encrypted credential payload is malformed.');
    }

    const decipher = createDecipheriv(ALGORITHM, this.#key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(additionalAuthenticatedData, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export function createOpaqueToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function constantTimeTokenHashEqual(candidateToken: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(hashOpaqueToken(candidateToken), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return candidateHash.length === expected.length && timingSafeEqual(candidateHash, expected);
}
