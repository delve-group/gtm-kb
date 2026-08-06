/* eslint-disable @typescript-eslint/require-await -- SQLite is synchronous behind an async replaceable store contract. */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import type { ActorContext, AuthMethod, RepositoryPermission } from '../auth/actor.js';
import { createPkcePair } from '../auth/pkce.js';

import {
  CredentialCipher,
  constantTimeTokenHashEqual,
  createOpaqueToken,
  hashOpaqueToken,
} from './crypto.js';
import {
  deserializeGitHubCredentials,
  type GitHubCredentialSet,
  serializeGitHubCredentials,
} from './github-credentials.js';
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

const CREDENTIAL_AAD_SUFFIX = 'github-credentials:v1';
const OAUTH_VERIFIER_AAD_SUFFIX = 'code-verifier:v1';

interface SessionRow {
  id: string;
  actor_json: string;
  github_credentials: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

interface OAuthStateRow {
  state_hash: string;
  code_verifier: string;
  redirect_uri: string;
  return_to: string | null;
  expires_at: number;
  consumed_at: number | null;
}

interface ExchangeCodeRow {
  session_id: string;
  expires_at: number;
  consumed_at: number | null;
}

export interface SqliteSessionStoreOptions {
  readonly path: string;
  readonly encryptionKey: string;
  readonly sessionTtlSeconds?: number;
  readonly oauthStateTtlSeconds?: number;
  readonly exchangeCodeTtlSeconds?: number;
  readonly busyTimeoutMs?: number;
  readonly clock?: () => Date;
}

export interface SqliteSessionStoreDiagnostics {
  readonly path: string;
  readonly journalMode: string;
  readonly busyTimeoutMs: number;
}

function assertPositiveTtl(name: string, ttlSeconds: number): void {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}

function isAuthMethod(value: unknown): value is AuthMethod {
  return value === 'secret' || value === 'github';
}

function isRepositoryPermission(value: unknown): value is RepositoryPermission {
  return ['none', 'read', 'triage', 'write', 'maintain', 'admin'].includes(String(value));
}

function deserializeActor(serialized: string): ActorContext {
  const parsed = JSON.parse(serialized) as Partial<ActorContext>;
  if (
    !isAuthMethod(parsed.authMethod) ||
    typeof parsed.repository !== 'string' ||
    !isRepositoryPermission(parsed.repositoryPermission) ||
    typeof parsed.canRead !== 'boolean' ||
    typeof parsed.canWrite !== 'boolean' ||
    (parsed.githubUserId !== undefined && typeof parsed.githubUserId !== 'number') ||
    (parsed.githubLogin !== undefined && typeof parsed.githubLogin !== 'string')
  ) {
    throw new Error('Stored session actor is invalid.');
  }

  return Object.freeze({
    authMethod: parsed.authMethod,
    repository: parsed.repository,
    repositoryPermission: parsed.repositoryPermission,
    canRead: parsed.canRead,
    canWrite: parsed.canWrite,
    ...(parsed.githubUserId === undefined ? {} : { githubUserId: parsed.githubUserId }),
    ...(parsed.githubLogin === undefined ? {} : { githubLogin: parsed.githubLogin }),
  });
}

export class SqliteSessionStore implements SessionStore {
  readonly #database: Database.Database;
  readonly #cipher: CredentialCipher;
  readonly #path: string;
  readonly #clock: () => Date;
  readonly #sessionTtlSeconds: number;
  readonly #oauthStateTtlSeconds: number;
  readonly #exchangeCodeTtlSeconds: number;
  readonly #busyTimeoutMs: number;
  #closed = false;

  constructor(options: SqliteSessionStoreOptions) {
    if (options.path.length === 0) {
      throw new TypeError('SESSION_DB_PATH must not be empty.');
    }

    this.#sessionTtlSeconds = options.sessionTtlSeconds ?? 3_600;
    this.#oauthStateTtlSeconds = options.oauthStateTtlSeconds ?? 600;
    this.#exchangeCodeTtlSeconds = options.exchangeCodeTtlSeconds ?? 120;
    this.#busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    assertPositiveTtl('SESSION_TTL_SECONDS', this.#sessionTtlSeconds);
    assertPositiveTtl('OAuth state TTL', this.#oauthStateTtlSeconds);
    assertPositiveTtl('Exchange code TTL', this.#exchangeCodeTtlSeconds);
    assertPositiveTtl('SQLite busy timeout', this.#busyTimeoutMs);

    this.#path = options.path;
    this.#clock = options.clock ?? (() => new Date());
    this.#cipher = new CredentialCipher(options.encryptionKey);

    if (options.path !== ':memory:') {
      mkdirSync(dirname(options.path), { recursive: true });
    }
    this.#database = new Database(options.path);
    this.#initializeSync();
  }

  async initialize(): Promise<void> {
    this.#assertOpen();
    this.#initializeSync();
  }

  async createSession(input: CreateSessionInput): Promise<IssuedSession> {
    this.#assertOpen();
    const ttlSeconds = input.ttlSeconds ?? this.#sessionTtlSeconds;
    assertPositiveTtl('Session TTL', ttlSeconds);
    const now = this.#nowMs();
    const sessionId = createOpaqueToken('ses');
    const expiresAt = now + ttlSeconds * 1_000;
    const encryptedCredentials =
      input.githubCredentials === undefined
        ? null
        : this.#cipher.encryptString(
            serializeGitHubCredentials(input.githubCredentials),
            this.#credentialAad(sessionId),
          );

    const create = this.#database.transaction(() => {
      this.#pruneExpiredSync(now);
      this.#database
        .prepare(
          `INSERT INTO sessions (
             id, auth_method, actor_json, github_credentials, created_at, expires_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          sessionId,
          input.actor.authMethod,
          JSON.stringify(input.actor),
          encryptedCredentials,
          now,
          expiresAt,
        );
      return this.#issueBearerTokenSync(sessionId, now, expiresAt);
    });

    const bearerToken = create();
    const session = this.#getActiveSessionByIdSync(sessionId, now);
    if (session === null) {
      throw new Error('Newly created session could not be loaded.');
    }
    return Object.freeze({ session, bearerToken });
  }

  async getSessionById(sessionId: string): Promise<SessionRecord | null> {
    this.#assertOpen();
    return this.#getActiveSessionByIdSync(sessionId, this.#nowMs());
  }

  async getSessionByBearerToken(bearerToken: string): Promise<SessionRecord | null> {
    this.#assertOpen();
    const now = this.#nowMs();
    const row = this.#database
      .prepare(
        `SELECT s.*
           FROM session_tokens t
           JOIN sessions s ON s.id = t.session_id
          WHERE t.token_hash = ?
            AND t.revoked_at IS NULL
            AND t.expires_at > ?
            AND s.revoked_at IS NULL
            AND s.expires_at > ?`,
      )
      .get(hashOpaqueToken(bearerToken), now, now) as SessionRow | undefined;
    return row === undefined ? null : this.#mapSession(row);
  }

  async issueBearerToken(sessionId: string): Promise<IssuedSession | null> {
    this.#assertOpen();
    const now = this.#nowMs();
    const session = this.#getActiveSessionByIdSync(sessionId, now);
    if (session === null) {
      return null;
    }
    const bearerToken = this.#issueBearerTokenSync(sessionId, now, session.expiresAt.getTime());
    return Object.freeze({ session, bearerToken });
  }

  async updateGitHubCredentials(
    sessionId: string,
    credentials: GitHubCredentialSet,
    expectedAccessToken?: string,
  ): Promise<boolean> {
    this.#assertOpen();
    const now = this.#nowMs();
    const update = this.#database.transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT github_credentials
             FROM sessions
            WHERE id = ?
              AND auth_method = 'github'
              AND revoked_at IS NULL
              AND expires_at > ?`,
        )
        .get(sessionId, now) as { github_credentials: string | null } | undefined;
      if (row?.github_credentials === undefined || row.github_credentials === null) {
        return false;
      }

      if (expectedAccessToken !== undefined) {
        const current = deserializeGitHubCredentials(
          this.#cipher.decryptString(row.github_credentials, this.#credentialAad(sessionId)),
        );
        if (
          !constantTimeTokenHashEqual(
            expectedAccessToken,
            hashOpaqueToken(current.getAccessToken()),
          )
        ) {
          return false;
        }
      }

      const encrypted = this.#cipher.encryptString(
        serializeGitHubCredentials(credentials),
        this.#credentialAad(sessionId),
      );
      const result = this.#database
        .prepare(
          `UPDATE sessions
              SET github_credentials = ?
            WHERE id = ?
              AND revoked_at IS NULL
              AND expires_at > ?`,
        )
        .run(encrypted, sessionId, now);
      return result.changes === 1;
    });
    return update();
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    this.#assertOpen();
    const now = this.#nowMs();
    const revoke = this.#database.transaction(() => {
      const result = this.#database
        .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(now, sessionId);
      this.#database
        .prepare(
          'UPDATE session_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL',
        )
        .run(now, sessionId);
      return result.changes > 0;
    });
    return revoke();
  }

  async createOAuthState(input: CreateOAuthStateInput): Promise<CreatedOAuthState> {
    this.#assertOpen();
    const ttlSeconds = input.ttlSeconds ?? this.#oauthStateTtlSeconds;
    assertPositiveTtl('OAuth state TTL', ttlSeconds);
    const redirectUri = new URL(input.redirectUri).toString();
    const now = this.#nowMs();
    const expiresAt = now + ttlSeconds * 1_000;
    const state = createOpaqueToken('oauth');
    const stateHash = hashOpaqueToken(state);
    const pkce = createPkcePair();
    const encryptedVerifier = this.#cipher.encryptString(
      pkce.codeVerifier,
      this.#oauthVerifierAad(stateHash),
    );

    const create = this.#database.transaction(() => {
      this.#pruneExpiredSync(now);
      this.#database
        .prepare(
          `INSERT INTO oauth_states (
             state_hash, code_verifier, redirect_uri, return_to, created_at, expires_at, consumed_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(stateHash, encryptedVerifier, redirectUri, input.returnTo ?? null, now, expiresAt);
    });
    create();

    return Object.freeze({
      state,
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: pkce.codeChallengeMethod,
      expiresAt: new Date(expiresAt),
    });
  }

  async consumeOAuthState(state: string, redirectUri: string): Promise<ConsumedOAuthState> {
    this.#assertOpen();
    const now = this.#nowMs();
    const stateHash = hashOpaqueToken(state);
    let canonicalRedirectUri: string;
    try {
      canonicalRedirectUri = new URL(redirectUri).toString();
    } catch {
      return Object.freeze({ status: 'redirect_mismatch' });
    }

    const consume = this.#database.transaction((): ConsumedOAuthState => {
      const row = this.#database
        .prepare('SELECT * FROM oauth_states WHERE state_hash = ?')
        .get(stateHash) as OAuthStateRow | undefined;
      if (row === undefined) {
        return Object.freeze({ status: 'invalid' });
      }
      if (row.consumed_at !== null) {
        return Object.freeze({ status: 'consumed' });
      }

      this.#database
        .prepare('UPDATE oauth_states SET consumed_at = ? WHERE state_hash = ?')
        .run(now, stateHash);

      if (row.expires_at <= now) {
        return Object.freeze({ status: 'expired' });
      }
      if (row.redirect_uri !== canonicalRedirectUri) {
        return Object.freeze({ status: 'redirect_mismatch' });
      }

      const codeVerifier = this.#cipher.decryptString(
        row.code_verifier,
        this.#oauthVerifierAad(row.state_hash),
      );
      return Object.freeze({
        status: 'ok',
        codeVerifier,
        ...(row.return_to === null ? {} : { returnTo: row.return_to }),
      });
    });

    return consume();
  }

  async createExchangeCode(
    sessionId: string,
    ttlSeconds = this.#exchangeCodeTtlSeconds,
  ): Promise<CreatedExchangeCode | null> {
    this.#assertOpen();
    assertPositiveTtl('Exchange code TTL', ttlSeconds);
    const now = this.#nowMs();
    const create = this.#database.transaction((): CreatedExchangeCode | null => {
      this.#pruneExpiredSync(now);
      if (this.#getActiveSessionByIdSync(sessionId, now) === null) {
        return null;
      }

      const code = createOpaqueToken('cbx');
      const expiresAt = Math.min(now + ttlSeconds * 1_000, this.#getSessionExpirySync(sessionId));
      this.#database
        .prepare(
          `INSERT INTO exchange_codes (
             code_hash, session_id, created_at, expires_at, consumed_at
           ) VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(hashOpaqueToken(code), sessionId, now, expiresAt);
      return Object.freeze({ code, expiresAt: new Date(expiresAt) });
    });
    return create();
  }

  async consumeExchangeCode(code: string): Promise<IssuedSession | null> {
    this.#assertOpen();
    const now = this.#nowMs();
    const codeHash = hashOpaqueToken(code);
    const consume = this.#database.transaction((): IssuedSession | null => {
      const row = this.#database
        .prepare('SELECT * FROM exchange_codes WHERE code_hash = ?')
        .get(codeHash) as ExchangeCodeRow | undefined;
      if (row?.consumed_at !== null) {
        return null;
      }

      this.#database
        .prepare('UPDATE exchange_codes SET consumed_at = ? WHERE code_hash = ?')
        .run(now, codeHash);
      if (row.expires_at <= now) {
        return null;
      }

      const session = this.#getActiveSessionByIdSync(row.session_id, now);
      if (session === null) {
        return null;
      }
      const bearerToken = this.#issueBearerTokenSync(session.id, now, session.expiresAt.getTime());
      return Object.freeze({ session, bearerToken });
    });
    return consume();
  }

  getDiagnostics(): SqliteSessionStoreDiagnostics {
    this.#assertOpen();
    const journalMode = String(this.#database.pragma('journal_mode', { simple: true }));
    const busyTimeoutMs = Number(this.#database.pragma('busy_timeout', { simple: true }));
    return Object.freeze({ path: this.#path, journalMode, busyTimeoutMs });
  }

  async close(): Promise<void> {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  #initializeSync(): void {
    this.#database.pragma(`busy_timeout = ${String(this.#busyTimeoutMs)}`);
    this.#database.pragma('foreign_keys = ON');
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('synchronous = NORMAL');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        auth_method TEXT NOT NULL CHECK (auth_method IN ('secret', 'github')),
        actor_json TEXT NOT NULL,
        github_credentials TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS session_tokens (
        token_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS session_tokens_session_id_idx
        ON session_tokens(session_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx
        ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY,
        code_verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        return_to TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx
        ON oauth_states(expires_at);

      CREATE TABLE IF NOT EXISTS exchange_codes (
        code_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS exchange_codes_expiry_idx
        ON exchange_codes(expires_at);
    `);
    this.#pruneExpiredSync(this.#nowMs());
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error('Session store is closed.');
    }
  }

  #nowMs(): number {
    return this.#clock().getTime();
  }

  #credentialAad(sessionId: string): string {
    return `session:${sessionId}:${CREDENTIAL_AAD_SUFFIX}`;
  }

  #oauthVerifierAad(stateHash: string): string {
    return `oauth-state:${stateHash}:${OAUTH_VERIFIER_AAD_SUFFIX}`;
  }

  #issueBearerTokenSync(sessionId: string, now: number, expiresAt: number): string {
    const bearerToken = createOpaqueToken('cbt');
    this.#database
      .prepare(
        `INSERT INTO session_tokens (
           token_hash, session_id, created_at, expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(hashOpaqueToken(bearerToken), sessionId, now, expiresAt);
    return bearerToken;
  }

  #pruneExpiredSync(now: number): void {
    this.#database
      .prepare('DELETE FROM oauth_states WHERE expires_at <= ? OR consumed_at IS NOT NULL')
      .run(now);
    this.#database
      .prepare('DELETE FROM exchange_codes WHERE expires_at <= ? OR consumed_at IS NOT NULL')
      .run(now);
    this.#database
      .prepare('DELETE FROM session_tokens WHERE expires_at <= ? OR revoked_at IS NOT NULL')
      .run(now);
    this.#database
      .prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL')
      .run(now);
  }

  #getActiveSessionByIdSync(sessionId: string, now: number): SessionRecord | null {
    const row = this.#database
      .prepare(
        `SELECT * FROM sessions
          WHERE id = ?
            AND revoked_at IS NULL
            AND expires_at > ?`,
      )
      .get(sessionId, now) as SessionRow | undefined;
    return row === undefined ? null : this.#mapSession(row);
  }

  #getSessionExpirySync(sessionId: string): number {
    const row = this.#database
      .prepare('SELECT expires_at FROM sessions WHERE id = ?')
      .get(sessionId) as { expires_at: number } | undefined;
    if (row === undefined) {
      throw new Error('Session does not exist.');
    }
    return row.expires_at;
  }

  #mapSession(row: SessionRow): SessionRecord {
    const githubCredentials =
      row.github_credentials === null
        ? null
        : deserializeGitHubCredentials(
            this.#cipher.decryptString(row.github_credentials, this.#credentialAad(row.id)),
          );
    return Object.freeze({
      id: row.id,
      actor: deserializeActor(row.actor_json),
      githubCredentials,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
    });
  }
}
