import { createHash, timingSafeEqual } from 'node:crypto';

import { createSecretActor, type ActorContext } from './actor.js';
import { AuthError } from './errors.js';

const BEARER_PATTERN = /^Bearer ([^\s]+)$/i;

export function constantTimeSecretEqual(candidate: string, expected: string): boolean {
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function parseBearerAuthorization(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const match = BEARER_PATTERN.exec(header.trim());
  return match?.[1] ?? null;
}

export interface SecretAuthenticatorOptions {
  secret: string;
  repository: string;
  allowWrites?: boolean;
  production?: boolean;
  minimumProductionLength?: number;
}

export class SecretAuthenticator {
  readonly #secret: string;
  readonly #actor: ActorContext;

  constructor(options: SecretAuthenticatorOptions) {
    const minimumLength = options.minimumProductionLength ?? 32;
    if (options.secret.length === 0) {
      throw new TypeError('SECRET_KEY must not be empty.');
    }
    if (options.production === true && options.secret.length < minimumLength) {
      throw new TypeError(
        `SECRET_KEY must be at least ${String(minimumLength)} characters in production.`,
      );
    }

    this.#secret = options.secret;
    this.#actor = createSecretActor({
      repository: options.repository,
      ...(options.allowWrites === undefined ? {} : { allowWrites: options.allowWrites }),
    });
  }

  matchesBearerToken(token: string): boolean {
    return constantTimeSecretEqual(token, this.#secret);
  }

  authenticate(authorizationHeader: string | undefined): ActorContext {
    const token = parseBearerAuthorization(authorizationHeader);
    if (token === null || !this.matchesBearerToken(token)) {
      throw new AuthError('UNAUTHENTICATED', 'Valid authentication is required.', 401);
    }
    return this.#actor;
  }
}
