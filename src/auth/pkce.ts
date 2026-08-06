import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
}

export function createPkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString('base64url');
  return Object.freeze({
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier, 'ascii').digest('base64url'),
    codeChallengeMethod: 'S256',
  });
}

export function createPkceChallenge(codeVerifier: string): string {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    throw new TypeError('PKCE code verifier must contain between 43 and 128 characters.');
  }
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}
