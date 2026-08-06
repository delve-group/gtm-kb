import type { ActorContext } from '../auth/actor.js';

import type { GitHubCredentialSet } from './github-credentials.js';

export interface SessionRecord {
  readonly id: string;
  readonly actor: ActorContext;
  readonly githubCredentials: GitHubCredentialSet | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface CreateSessionInput {
  readonly actor: ActorContext;
  readonly githubCredentials?: GitHubCredentialSet;
  readonly ttlSeconds?: number;
}

export interface IssuedSession {
  readonly session: SessionRecord;
  readonly bearerToken: string;
}

export interface CreatedOAuthState {
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
  readonly expiresAt: Date;
}

export interface CreateOAuthStateInput {
  readonly redirectUri: string;
  readonly returnTo?: string;
  readonly ttlSeconds?: number;
}

export type OAuthStateFailureReason = 'invalid' | 'expired' | 'consumed' | 'redirect_mismatch';

export type ConsumedOAuthState =
  | {
      readonly status: 'ok';
      readonly codeVerifier: string;
      readonly returnTo?: string;
    }
  | {
      readonly status: OAuthStateFailureReason;
    };

export interface CreatedExchangeCode {
  readonly code: string;
  readonly expiresAt: Date;
}

export interface SessionStore {
  initialize(): Promise<void>;
  createSession(input: CreateSessionInput): Promise<IssuedSession>;
  getSessionById(sessionId: string): Promise<SessionRecord | null>;
  getSessionByBearerToken(bearerToken: string): Promise<SessionRecord | null>;
  issueBearerToken(sessionId: string): Promise<IssuedSession | null>;
  updateGitHubCredentials(
    sessionId: string,
    credentials: GitHubCredentialSet,
    expectedAccessToken?: string,
  ): Promise<boolean>;
  revokeSession(sessionId: string): Promise<boolean>;
  createOAuthState(input: CreateOAuthStateInput): Promise<CreatedOAuthState>;
  consumeOAuthState(state: string, redirectUri: string): Promise<ConsumedOAuthState>;
  createExchangeCode(sessionId: string, ttlSeconds?: number): Promise<CreatedExchangeCode | null>;
  consumeExchangeCode(code: string): Promise<IssuedSession | null>;
  close(): Promise<void>;
}
