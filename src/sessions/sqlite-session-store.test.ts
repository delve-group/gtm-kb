import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createGitHubActor } from '../auth/actor.js';
import { createPkceChallenge } from '../auth/pkce.js';

import { hashOpaqueToken } from './crypto.js';
import { GitHubCredentialSet } from './github-credentials.js';
import { SqliteSessionStore } from './sqlite-session-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'company-brain-sessions-'));
  temporaryDirectories.push(directory);
  return join(directory, 'initially-empty', 'sessions.sqlite');
}

function encryptionKey(): string {
  return randomBytes(32).toString('base64');
}

function githubActor() {
  return createGitHubActor({
    githubUserId: 42,
    githubLogin: 'octocat',
    repository: 'superseller/company-brain',
    repositoryPermission: 'write',
    appCanRead: true,
    appCanWrite: true,
  });
}

function githubCredentials(accessToken = 'github-access-token-secret') {
  return new GitHubCredentialSet({
    accessToken,
    refreshToken: 'github-refresh-token-secret',
    accessTokenExpiresAt: new Date('2026-08-06T14:00:00.000Z'),
  });
}

describe('SqliteSessionStore', () => {
  it('initializes an empty persistent directory with WAL and a busy timeout', async () => {
    const path = temporaryDatabasePath();
    const store = new SqliteSessionStore({ path, encryptionKey: encryptionKey() });

    expect(store.getDiagnostics()).toMatchObject({
      path,
      journalMode: 'wal',
      busyTimeoutMs: 5_000,
    });
    await store.close();
  });

  it('stores only bearer hashes and encrypted GitHub credentials', async () => {
    const path = temporaryDatabasePath();
    const key = encryptionKey();
    const store = new SqliteSessionStore({ path, encryptionKey: key });
    const issued = await store.createSession({
      actor: githubActor(),
      githubCredentials: githubCredentials(),
    });

    const database = new Database(path, { readonly: true });
    const tokenRow = database.prepare('SELECT token_hash FROM session_tokens').get() as {
      token_hash: string;
    };
    const sessionRow = database.prepare('SELECT github_credentials FROM sessions').get() as {
      github_credentials: string;
    };
    database.close();

    expect(tokenRow.token_hash).toBe(hashOpaqueToken(issued.bearerToken));
    expect(tokenRow.token_hash).not.toContain(issued.bearerToken);
    expect(sessionRow.github_credentials).not.toContain('github-access-token-secret');
    expect(sessionRow.github_credentials).not.toContain('github-refresh-token-secret');

    const loaded = await store.getSessionByBearerToken(issued.bearerToken);
    expect(loaded?.githubCredentials?.getAccessToken()).toBe('github-access-token-secret');
    expect(JSON.stringify(loaded?.githubCredentials)).not.toContain('github-access-token-secret');
    await store.close();
  });

  it('persists active sessions across a store restart', async () => {
    const path = temporaryDatabasePath();
    const key = encryptionKey();
    const first = new SqliteSessionStore({ path, encryptionKey: key });
    const issued = await first.createSession({
      actor: githubActor(),
      githubCredentials: githubCredentials(),
    });
    await first.close();

    const reopened = new SqliteSessionStore({ path, encryptionKey: key });
    const loaded = await reopened.getSessionByBearerToken(issued.bearerToken);
    expect(loaded?.id).toBe(issued.session.id);
    expect(loaded?.actor.githubLogin).toBe('octocat');
    await reopened.close();
  });

  it('fails closed after expiry and explicit revocation', async () => {
    let now = new Date('2026-08-06T12:00:00.000Z');
    const store = new SqliteSessionStore({
      path: temporaryDatabasePath(),
      encryptionKey: encryptionKey(),
      clock: () => now,
      sessionTtlSeconds: 60,
    });
    const expired = await store.createSession({
      actor: githubActor(),
      githubCredentials: githubCredentials(),
    });
    now = new Date('2026-08-06T12:01:00.000Z');
    expect(await store.getSessionById(expired.session.id)).toBeNull();
    expect(await store.getSessionByBearerToken(expired.bearerToken)).toBeNull();

    now = new Date('2026-08-06T12:02:00.000Z');
    const revoked = await store.createSession({
      actor: githubActor(),
      githubCredentials: githubCredentials(),
    });
    expect(await store.revokeSession(revoked.session.id)).toBe(true);
    expect(await store.getSessionByBearerToken(revoked.bearerToken)).toBeNull();
    expect(await store.revokeSession(revoked.session.id)).toBe(false);
    await store.close();
  });

  it('atomically rotates encrypted GitHub credentials with compare-and-swap', async () => {
    const store = new SqliteSessionStore({
      path: temporaryDatabasePath(),
      encryptionKey: encryptionKey(),
    });
    const issued = await store.createSession({
      actor: githubActor(),
      githubCredentials: githubCredentials('old-access-token'),
    });

    expect(
      await store.updateGitHubCredentials(
        issued.session.id,
        githubCredentials('new-access-token'),
        'wrong-old-token',
      ),
    ).toBe(false);
    expect(
      await store.updateGitHubCredentials(
        issued.session.id,
        githubCredentials('new-access-token'),
        'old-access-token',
      ),
    ).toBe(true);
    expect(
      (await store.getSessionById(issued.session.id))?.githubCredentials?.getAccessToken(),
    ).toBe('new-access-token');
    await store.close();
  });

  it('uses PKCE S256 and rejects mismatched, expired, and reused OAuth state', async () => {
    let now = new Date('2026-08-06T12:00:00.000Z');
    const store = new SqliteSessionStore({
      path: temporaryDatabasePath(),
      encryptionKey: encryptionKey(),
      clock: () => now,
      oauthStateTtlSeconds: 60,
    });
    const redirectUri = 'https://brain.example.com/auth/github/callback';

    const valid = await store.createOAuthState({ redirectUri, returnTo: '/demo' });
    expect(valid.codeChallengeMethod).toBe('S256');
    const consumed = await store.consumeOAuthState(valid.state, redirectUri);
    expect(consumed.status).toBe('ok');
    if (consumed.status === 'ok') {
      expect(createPkceChallenge(consumed.codeVerifier)).toBe(valid.codeChallenge);
      expect(consumed.returnTo).toBe('/demo');
    }
    expect((await store.consumeOAuthState(valid.state, redirectUri)).status).toBe('consumed');
    expect((await store.consumeOAuthState('oauth_not-the-state', redirectUri)).status).toBe(
      'invalid',
    );

    const mismatch = await store.createOAuthState({ redirectUri });
    expect(
      (await store.consumeOAuthState(mismatch.state, 'https://evil.example/callback')).status,
    ).toBe('redirect_mismatch');
    expect((await store.consumeOAuthState(mismatch.state, redirectUri)).status).toBe('consumed');

    const expired = await store.createOAuthState({ redirectUri });
    now = new Date('2026-08-06T12:01:00.000Z');
    expect((await store.consumeOAuthState(expired.state, redirectUri)).status).toBe('expired');
    await store.close();
  });

  it('exchanges a one-time code for a new hashed bearer token exactly once', async () => {
    const path = temporaryDatabasePath();
    const store = new SqliteSessionStore({ path, encryptionKey: encryptionKey() });
    const issued = await store.createSession({
      actor: githubActor(),
      githubCredentials: githubCredentials(),
    });
    const exchange = await store.createExchangeCode(issued.session.id);
    expect(exchange).not.toBeNull();
    if (exchange === null) throw new Error('Expected exchange code');

    const exchanged = await store.consumeExchangeCode(exchange.code);
    expect(exchanged?.session.id).toBe(issued.session.id);
    expect(exchanged?.bearerToken).not.toBe(issued.bearerToken);
    expect(await store.consumeExchangeCode(exchange.code)).toBeNull();

    const database = new Database(path, { readonly: true });
    const row = database.prepare('SELECT code_hash FROM exchange_codes').get() as {
      code_hash: string;
    };
    database.close();
    expect(row.code_hash).toBe(createHash('sha256').update(exchange.code).digest('hex'));
    expect(row.code_hash).not.toContain(exchange.code);
    await store.close();
  });

  it('prunes expired and consumed authentication records during new writes', async () => {
    const path = temporaryDatabasePath();
    let now = new Date('2026-08-06T12:00:00.000Z');
    const store = new SqliteSessionStore({
      path,
      encryptionKey: encryptionKey(),
      clock: () => now,
      sessionTtlSeconds: 60,
      oauthStateTtlSeconds: 60,
      exchangeCodeTtlSeconds: 60,
    });
    const redirectUri = 'https://brain.example.com/auth/github/callback';
    const oldState = await store.createOAuthState({ redirectUri });
    await store.consumeOAuthState(oldState.state, redirectUri);
    const session = await store.createSession({
      actor: githubActor(),
      githubCredentials: githubCredentials(),
    });
    const exchange = await store.createExchangeCode(session.session.id);
    if (exchange === null) throw new Error('Expected exchange code');
    await store.consumeExchangeCode(exchange.code);

    now = new Date('2026-08-06T12:01:00.000Z');
    await store.createOAuthState({ redirectUri });

    const database = new Database(path, { readonly: true });
    const counts = {
      states: (
        database.prepare('SELECT COUNT(*) AS count FROM oauth_states').get() as {
          count: number;
        }
      ).count,
      sessions: (
        database.prepare('SELECT COUNT(*) AS count FROM sessions').get() as {
          count: number;
        }
      ).count,
      tokens: (
        database.prepare('SELECT COUNT(*) AS count FROM session_tokens').get() as {
          count: number;
        }
      ).count,
      exchanges: (
        database.prepare('SELECT COUNT(*) AS count FROM exchange_codes').get() as {
          count: number;
        }
      ).count,
    };
    database.close();

    expect(counts).toEqual({ states: 1, sessions: 0, tokens: 0, exchanges: 0 });
    await store.close();
  });
});
