/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars -- Disabled adapter preserves the async SessionStore contract without performing I/O. */
import type { GitHubCredentialSet } from './github-credentials.js';
import type {
  ConsumedOAuthState,
  CreateOAuthStateInput,
  CreatedExchangeCode,
  CreatedOAuthState,
  CreateSessionInput,
  IssuedSession,
  SessionRecord,
  SessionStore,
} from './types.js';

/** SessionStore used only when AUTH_MODE=secret and GitHub session features are disabled. */
export class DisabledSessionStore implements SessionStore {
  async initialize(): Promise<void> {}
  async createSession(_input: CreateSessionInput): Promise<IssuedSession> {
    throw new Error('Session support is disabled.');
  }
  async getSessionById(_sessionId: string): Promise<SessionRecord | null> {
    return null;
  }
  async getSessionByBearerToken(_bearerToken: string): Promise<SessionRecord | null> {
    return null;
  }
  async issueBearerToken(_sessionId: string): Promise<IssuedSession | null> {
    return null;
  }
  async updateGitHubCredentials(
    _sessionId: string,
    _credentials: GitHubCredentialSet,
    _expectedAccessToken?: string,
  ): Promise<boolean> {
    return false;
  }
  async revokeSession(_sessionId: string): Promise<boolean> {
    return false;
  }
  async createOAuthState(_input: CreateOAuthStateInput): Promise<CreatedOAuthState> {
    throw new Error('OAuth support is disabled.');
  }
  async consumeOAuthState(_state: string, _redirectUri: string): Promise<ConsumedOAuthState> {
    return { status: 'invalid' };
  }
  async createExchangeCode(
    _sessionId: string,
    _ttlSeconds?: number,
  ): Promise<CreatedExchangeCode | null> {
    return null;
  }
  async consumeExchangeCode(_code: string): Promise<IssuedSession | null> {
    return null;
  }
  async close(): Promise<void> {}
}
