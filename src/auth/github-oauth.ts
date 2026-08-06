import type { SessionStore } from '../sessions/types.js';
import { GitHubCredentialSet } from '../sessions/github-credentials.js';

import { OAuthStateError } from './errors.js';

const DEFAULT_AUTHORIZE_ENDPOINT = 'https://github.com/login/oauth/authorize';
const DEFAULT_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';

interface GitHubTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
}

export interface GitHubOAuthClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly fetch?: typeof fetch;
  readonly clock?: () => Date;
}

export class GitHubOAuthError extends Error {
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitHubOAuthError';
    this.statusCode = statusCode;
  }
}

function validateHttpUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${name} must use http or https.`);
  }
  return url;
}

export function githubCallbackUrl(publicBaseUrl: string): string {
  const base = validateHttpUrl(publicBaseUrl, 'PUBLIC_BASE_URL');
  if (base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') {
    throw new TypeError('PUBLIC_BASE_URL must not contain credentials, a query, or a fragment.');
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/auth/github/callback`;
  return base.toString();
}

export class GitHubOAuthClient {
  readonly callbackUrl: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #authorizationEndpoint: string;
  readonly #tokenEndpoint: string;
  readonly #fetch: typeof fetch;
  readonly #clock: () => Date;

  constructor(options: GitHubOAuthClientOptions) {
    if (options.clientId.length === 0 || options.clientSecret.length === 0) {
      throw new TypeError('GitHub OAuth client ID and client secret are required.');
    }
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.callbackUrl = validateHttpUrl(options.callbackUrl, 'GitHub OAuth callback URL').toString();
    this.#authorizationEndpoint = validateHttpUrl(
      options.authorizationEndpoint ?? DEFAULT_AUTHORIZE_ENDPOINT,
      'GitHub authorization endpoint',
    ).toString();
    this.#tokenEndpoint = validateHttpUrl(
      options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
      'GitHub token endpoint',
    ).toString();
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#clock = options.clock ?? (() => new Date());
  }

  buildAuthorizationUrl(input: { state: string; codeChallenge: string; login?: string }): string {
    if (input.state.length === 0 || input.codeChallenge.length === 0) {
      throw new TypeError('OAuth state and PKCE code challenge are required.');
    }
    const url = new URL(this.#authorizationEndpoint);
    url.searchParams.set('client_id', this.#clientId);
    url.searchParams.set('redirect_uri', this.callbackUrl);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (input.login !== undefined) {
      url.searchParams.set('login', input.login);
    }
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<GitHubCredentialSet> {
    if (code.length === 0 || codeVerifier.length === 0) {
      throw new TypeError('OAuth code and PKCE code verifier are required.');
    }
    return this.#requestToken({
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
      code,
      redirect_uri: this.callbackUrl,
      code_verifier: codeVerifier,
    });
  }

  async refresh(credentials: GitHubCredentialSet): Promise<GitHubCredentialSet> {
    const refreshToken = credentials.getRefreshToken();
    if (refreshToken === undefined) {
      throw new GitHubOAuthError(
        'GitHub credentials cannot be refreshed; reauthorization is required.',
      );
    }
    return this.#requestToken({
      client_id: this.#clientId,
      client_secret: this.#clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  async #requestToken(parameters: Readonly<Record<string, string>>): Promise<GitHubCredentialSet> {
    let response: Response;
    try {
      response = await this.#fetch(this.#tokenEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'superseller-company-brain',
        },
        body: new URLSearchParams(parameters),
      });
    } catch (cause) {
      throw new GitHubOAuthError('GitHub OAuth is temporarily unavailable.', null, { cause });
    }

    let payload: GitHubTokenResponse;
    try {
      payload = (await response.json()) as GitHubTokenResponse;
    } catch (cause) {
      throw new GitHubOAuthError('GitHub OAuth returned an invalid response.', response.status, {
        cause,
      });
    }

    if (!response.ok || typeof payload.error === 'string') {
      throw new GitHubOAuthError('GitHub rejected the OAuth credential request.', response.status);
    }
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
      throw new GitHubOAuthError(
        'GitHub OAuth response did not contain an access token.',
        response.status,
      );
    }

    const now = this.#clock().getTime();
    return new GitHubCredentialSet({
      accessToken: payload.access_token,
      ...(typeof payload.refresh_token === 'string' ? { refreshToken: payload.refresh_token } : {}),
      ...(typeof payload.expires_in === 'number'
        ? { accessTokenExpiresAt: new Date(now + payload.expires_in * 1_000) }
        : {}),
      ...(typeof payload.refresh_token_expires_in === 'number'
        ? { refreshTokenExpiresAt: new Date(now + payload.refresh_token_expires_in * 1_000) }
        : {}),
      ...(typeof payload.token_type === 'string' ? { tokenType: payload.token_type } : {}),
      ...(typeof payload.scope === 'string' ? { scope: payload.scope } : {}),
    });
  }
}

export interface BeginGitHubOAuthResult {
  readonly authorizationUrl: string;
  readonly expiresAt: Date;
}

export class GitHubOAuthFlow {
  readonly #sessions: SessionStore;
  readonly #client: GitHubOAuthClient;

  constructor(sessions: SessionStore, client: GitHubOAuthClient) {
    this.#sessions = sessions;
    this.#client = client;
  }

  async begin(input: { returnTo?: string; login?: string } = {}): Promise<BeginGitHubOAuthResult> {
    const state = await this.#sessions.createOAuthState({
      redirectUri: this.#client.callbackUrl,
      ...(input.returnTo === undefined ? {} : { returnTo: input.returnTo }),
    });
    return Object.freeze({
      authorizationUrl: this.#client.buildAuthorizationUrl({
        state: state.state,
        codeChallenge: state.codeChallenge,
        ...(input.login === undefined ? {} : { login: input.login }),
      }),
      expiresAt: state.expiresAt,
    });
  }

  async complete(input: {
    code: string;
    state: string;
    callbackUrl: string;
  }): Promise<{ readonly credentials: GitHubCredentialSet; readonly returnTo?: string }> {
    if (input.callbackUrl !== this.#client.callbackUrl) {
      throw new OAuthStateError('redirect_mismatch');
    }
    const state = await this.#sessions.consumeOAuthState(input.state, input.callbackUrl);
    if (state.status !== 'ok') {
      throw new OAuthStateError(state.status);
    }
    const credentials = await this.#client.exchangeCode(input.code, state.codeVerifier);
    return Object.freeze({
      credentials,
      ...(state.returnTo === undefined ? {} : { returnTo: state.returnTo }),
    });
  }
}
