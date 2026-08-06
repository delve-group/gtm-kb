import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { GitHubCredentialSet } from '../sessions/github-credentials.js';

import { createGitHubActor, createSecretActor } from './actor.js';
import { BrowserSessionCookie } from './browser-cookie.js';
import { AuthError } from './errors.js';
import {
  GitHubAuthorizationService,
  type GitHubAuthorizationGateway,
  type GitHubRepositoryAuthorization,
} from './github-authorization.js';
import { GitHubOAuthClient, githubCallbackUrl } from './github-oauth.js';
import { createPkcePair } from './pkce.js';
import {
  SecretAuthenticator,
  constantTimeSecretEqual,
  parseBearerAuthorization,
} from './secret-auth.js';

describe('secret authentication and actors', () => {
  it('accepts a valid bearer in constant time and rejects missing or invalid credentials', () => {
    const secret = 'a-secure-demo-secret-that-is-long-enough';
    const authenticator = new SecretAuthenticator({
      secret,
      repository: 'superseller/company-brain',
      production: true,
    });

    expect(authenticator.authenticate(`Bearer ${secret}`).canWrite).toBe(false);
    expect(() => authenticator.authenticate(undefined)).toThrow(AuthError);
    expect(() => authenticator.authenticate('Bearer wrong')).toThrow(AuthError);
    expect(constantTimeSecretEqual('different-length', secret)).toBe(false);
    expect(constantTimeSecretEqual(secret, secret)).toBe(true);
    expect(parseBearerAuthorization(`Bearer ${secret}`)).toBe(secret);
    expect(parseBearerAuthorization('Basic abc')).toBeNull();
  });

  it('creates immutable actor contexts and keeps shared-secret writes opt-in', () => {
    const readOnly = createSecretActor({ repository: 'superseller/company-brain' });
    const writer = createSecretActor({
      repository: 'superseller/company-brain',
      allowWrites: true,
    });
    const github = createGitHubActor({
      githubUserId: 1,
      githubLogin: 'octocat',
      repository: 'superseller/company-brain',
      repositoryPermission: 'write',
      appCanRead: true,
      appCanWrite: false,
    });

    expect(Object.isFrozen(readOnly)).toBe(true);
    expect(readOnly.canWrite).toBe(false);
    expect(writer.canWrite).toBe(true);
    expect(github.canRead).toBe(true);
    expect(github.canWrite).toBe(false);
  });
});

describe('browser session cookies', () => {
  it('signs opaque HttpOnly cookies and enables Secure only for HTTPS', () => {
    const secret = randomBytes(32).toString('base64url');
    const cookie = new BrowserSessionCookie({
      secret,
      publicBaseUrl: 'https://brain.example.com',
      maxAgeSeconds: 3_600,
    });
    const serialized = cookie.serialize('ses_opaque-id');

    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Secure');
    expect(serialized).not.toContain('ses_opaque-id');
    expect(cookie.read(serialized)).toBe('ses_opaque-id');
    expect(cookie.verify(`${cookie.sign('ses_opaque-id')}tampered`)).toBeNull();

    const local = new BrowserSessionCookie({
      secret,
      publicBaseUrl: 'http://127.0.0.1:3000',
    });
    expect(local.serialize('ses_local')).not.toContain('Secure');
  });
});

describe('GitHub OAuth primitives', () => {
  it('derives the callback only from PUBLIC_BASE_URL', () => {
    expect(githubCallbackUrl('https://brain.example.com')).toBe(
      'https://brain.example.com/auth/github/callback',
    );
    expect(githubCallbackUrl('https://brain.example.com/company-brain/')).toBe(
      'https://brain.example.com/company-brain/auth/github/callback',
    );
  });

  it('builds a PKCE S256 authorization URL and exchanges a code offline', async () => {
    let capturedBody = '';
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected form body');
      capturedBody = init.body.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'access-secret',
            expires_in: 28_800,
            refresh_token: 'refresh-secret',
            refresh_token_expires_in: 15_552_000,
            token_type: 'bearer',
            scope: '',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;
    const client = new GitHubOAuthClient({
      clientId: 'github-client-id',
      clientSecret: 'github-client-secret',
      callbackUrl: 'https://brain.example.com/auth/github/callback',
      fetch: fetchMock,
      clock: () => new Date('2026-08-06T12:00:00.000Z'),
    });
    const pkce = createPkcePair();
    const authorizationUrl = new URL(
      client.buildAuthorizationUrl({
        state: 'oauth_random-state',
        codeChallenge: pkce.codeChallenge,
      }),
    );

    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(client.callbackUrl);
    expect(authorizationUrl.searchParams.get('state')).toBe('oauth_random-state');
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe(pkce.codeChallenge);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const credentials = await client.exchangeCode('one-time-code', pkce.codeVerifier);
    const tokenRequest = new URLSearchParams(capturedBody);
    expect(tokenRequest.get('redirect_uri')).toBe(client.callbackUrl);
    expect(tokenRequest.get('code_verifier')).toBe(pkce.codeVerifier);
    expect(credentials.getAccessToken()).toBe('access-secret');
    expect(credentials.getRefreshToken()).toBe('refresh-secret');
    expect(JSON.stringify(credentials)).not.toContain('access-secret');
    expect(inspect(credentials)).not.toContain('access-secret');
  });

  it('refreshes user credentials without exposing either token', async () => {
    let capturedBody = '';
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!(init?.body instanceof URLSearchParams)) throw new Error('Expected form body');
      capturedBody = init.body.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'rotated', token_type: 'bearer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;
    const client = new GitHubOAuthClient({
      clientId: 'client',
      clientSecret: 'secret',
      callbackUrl: 'https://brain.example.com/auth/github/callback',
      fetch: fetchMock,
    });
    const refreshed = await client.refresh(
      new GitHubCredentialSet({ accessToken: 'old', refreshToken: 'refresh-secret' }),
    );

    const request = new URLSearchParams(capturedBody);
    expect(request.get('grant_type')).toBe('refresh_token');
    expect(request.get('refresh_token')).toBe('refresh-secret');
    expect(refreshed.getAccessToken()).toBe('rotated');
    expect(JSON.stringify(refreshed)).not.toContain('rotated');
  });
});

describe('GitHub repository authorization', () => {
  function credentials() {
    return new GitHubCredentialSet({ accessToken: 'internal-token' });
  }

  it('returns the verified immutable actor from user/app permission intersection', async () => {
    const gateway: GitHubAuthorizationGateway = {
      verifyUser: vi.fn(() => Promise.resolve({ id: 42, login: 'octocat' })),
      getRepositoryAuthorization: vi.fn((): Promise<GitHubRepositoryAuthorization> =>
        Promise.resolve({
          installationHasRepositoryAccess: true,
          userPermission: 'write',
          appPermissions: { contents: 'write', pullRequests: 'write' },
        }),
      ),
      isOrganizationMember: vi.fn(() => Promise.resolve(true)),
    };
    const authorizer = new GitHubAuthorizationService(gateway, {
      repository: 'superseller/company-brain',
      allowedOrganizations: ['superseller'],
    });

    const actor = await authorizer.authorize(credentials());
    expect(actor).toMatchObject({
      authMethod: 'github',
      githubUserId: 42,
      githubLogin: 'octocat',
      repositoryPermission: 'write',
      canRead: true,
      canWrite: true,
    });
    expect(Object.isFrozen(actor)).toBe(true);
  });

  it('rejects users without repository read access with 403', async () => {
    const gateway: GitHubAuthorizationGateway = {
      verifyUser: vi.fn(() => Promise.resolve({ id: 42, login: 'octocat' })),
      getRepositoryAuthorization: vi.fn((): Promise<GitHubRepositoryAuthorization> =>
        Promise.resolve({
          installationHasRepositoryAccess: true,
          userPermission: 'none',
          appPermissions: { contents: 'read', pullRequests: 'read' },
        }),
      ),
    };
    const authorizer = new GitHubAuthorizationService(gateway, {
      repository: 'superseller/company-brain',
    });

    await expect(authorizer.authorize(credentials())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('keeps proposal writes disabled when the app lacks write permission', async () => {
    const gateway: GitHubAuthorizationGateway = {
      verifyUser: vi.fn(() => Promise.resolve({ id: 42, login: 'octocat' })),
      getRepositoryAuthorization: vi.fn((): Promise<GitHubRepositoryAuthorization> =>
        Promise.resolve({
          installationHasRepositoryAccess: true,
          userPermission: 'admin',
          appPermissions: { contents: 'read', pullRequests: 'read' },
        }),
      ),
    };
    const authorizer = new GitHubAuthorizationService(gateway, {
      repository: 'superseller/company-brain',
    });

    expect((await authorizer.authorize(credentials())).canWrite).toBe(false);
  });
});
