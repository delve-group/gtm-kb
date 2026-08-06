import { inspect } from 'node:util';

export interface GitHubCredentialInput {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  tokenType?: string;
  scope?: string;
}

interface StoredGitHubCredentials {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  tokenType?: string;
  scope?: string;
}

export class GitHubCredentialSet {
  readonly accessTokenExpiresAt: Date | undefined;
  readonly refreshTokenExpiresAt: Date | undefined;
  readonly tokenType: string | undefined;
  readonly scope: string | undefined;
  readonly #accessToken: string;
  readonly #refreshToken: string | undefined;

  constructor(input: GitHubCredentialInput) {
    if (input.accessToken.length === 0) {
      throw new TypeError('GitHub access token must not be empty.');
    }
    this.#accessToken = input.accessToken;
    this.#refreshToken = input.refreshToken;
    this.accessTokenExpiresAt = input.accessTokenExpiresAt;
    this.refreshTokenExpiresAt = input.refreshTokenExpiresAt;
    this.tokenType = input.tokenType;
    this.scope = input.scope;
    Object.freeze(this);
  }

  getAccessToken(): string {
    return this.#accessToken;
  }

  getRefreshToken(): string | undefined {
    return this.#refreshToken;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      accessToken: '[REDACTED]',
      ...(this.#refreshToken === undefined ? {} : { refreshToken: '[REDACTED]' }),
      ...(this.accessTokenExpiresAt === undefined
        ? {}
        : { accessTokenExpiresAt: this.accessTokenExpiresAt.toISOString() }),
      ...(this.refreshTokenExpiresAt === undefined
        ? {}
        : { refreshTokenExpiresAt: this.refreshTokenExpiresAt.toISOString() }),
      ...(this.tokenType === undefined ? {} : { tokenType: this.tokenType }),
      ...(this.scope === undefined ? {} : { scope: this.scope }),
    });
  }

  [inspect.custom](): Readonly<Record<string, unknown>> {
    return this.toJSON();
  }
}

export function serializeGitHubCredentials(credentials: GitHubCredentialSet): string {
  const refreshToken = credentials.getRefreshToken();
  const stored: StoredGitHubCredentials = {
    accessToken: credentials.getAccessToken(),
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(credentials.accessTokenExpiresAt === undefined
      ? {}
      : { accessTokenExpiresAt: credentials.accessTokenExpiresAt.toISOString() }),
    ...(credentials.refreshTokenExpiresAt === undefined
      ? {}
      : { refreshTokenExpiresAt: credentials.refreshTokenExpiresAt.toISOString() }),
    ...(credentials.tokenType === undefined ? {} : { tokenType: credentials.tokenType }),
    ...(credentials.scope === undefined ? {} : { scope: credentials.scope }),
  };
  return JSON.stringify(stored);
}

export function deserializeGitHubCredentials(serialized: string): GitHubCredentialSet {
  const parsed = JSON.parse(serialized) as StoredGitHubCredentials;
  if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) {
    throw new Error('Stored GitHub credential payload is invalid.');
  }
  return new GitHubCredentialSet({
    accessToken: parsed.accessToken,
    ...(parsed.refreshToken === undefined ? {} : { refreshToken: parsed.refreshToken }),
    ...(parsed.accessTokenExpiresAt === undefined
      ? {}
      : { accessTokenExpiresAt: new Date(parsed.accessTokenExpiresAt) }),
    ...(parsed.refreshTokenExpiresAt === undefined
      ? {}
      : { refreshTokenExpiresAt: new Date(parsed.refreshTokenExpiresAt) }),
    ...(parsed.tokenType === undefined ? {} : { tokenType: parsed.tokenType }),
    ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
  });
}
