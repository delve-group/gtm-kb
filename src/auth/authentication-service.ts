import { inspect } from 'node:util';

import type { GitHubCredentialSet } from '../sessions/github-credentials.js';
import type { SessionRecord, SessionStore } from '../sessions/types.js';

import type { ActorContext } from './actor.js';
import type { BrowserSessionCookie } from './browser-cookie.js';
import { AuthError } from './errors.js';
import { parseBearerAuthorization, type SecretAuthenticator } from './secret-auth.js';

export type AuthenticationMode = 'secret' | 'github' | 'hybrid';

export class AuthenticatedPrincipal {
  readonly actor: ActorContext;
  readonly sessionId: string | undefined;
  readonly #githubCredentials: GitHubCredentialSet | null;

  constructor(input: {
    actor: ActorContext;
    sessionId?: string;
    githubCredentials?: GitHubCredentialSet | null;
  }) {
    this.actor = input.actor;
    this.sessionId = input.sessionId;
    this.#githubCredentials = input.githubCredentials ?? null;
    Object.freeze(this);
  }

  getGitHubCredentials(): GitHubCredentialSet | null {
    return this.#githubCredentials;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      actor: this.actor,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
    });
  }

  [inspect.custom](): Readonly<Record<string, unknown>> {
    return this.toJSON();
  }
}

export interface AuthenticationServiceOptions {
  readonly mode: AuthenticationMode;
  readonly sessions: SessionStore;
  readonly secretAuthenticator?: SecretAuthenticator;
  readonly browserCookie?: BrowserSessionCookie;
}

export class AuthenticationService {
  readonly #mode: AuthenticationMode;
  readonly #sessions: SessionStore;
  readonly #secretAuthenticator: SecretAuthenticator | undefined;
  readonly #browserCookie: BrowserSessionCookie | undefined;

  constructor(options: AuthenticationServiceOptions) {
    if (
      (options.mode === 'secret' || options.mode === 'hybrid') &&
      options.secretAuthenticator === undefined
    ) {
      throw new TypeError('SECRET_KEY authentication is required by AUTH_MODE.');
    }
    if (
      (options.mode === 'github' || options.mode === 'hybrid') &&
      options.browserCookie === undefined
    ) {
      throw new TypeError('Browser session cookie support is required by AUTH_MODE.');
    }
    this.#mode = options.mode;
    this.#sessions = options.sessions;
    this.#secretAuthenticator = options.secretAuthenticator;
    this.#browserCookie = options.browserCookie;
  }

  async authenticate(input: {
    authorizationHeader?: string;
    cookieHeader?: string;
  }): Promise<AuthenticatedPrincipal> {
    const bearerToken = parseBearerAuthorization(input.authorizationHeader);
    if (bearerToken !== null) {
      if (
        this.#mode !== 'github' &&
        this.#secretAuthenticator?.matchesBearerToken(bearerToken) === true
      ) {
        return new AuthenticatedPrincipal({
          actor: this.#secretAuthenticator.authenticate(input.authorizationHeader),
        });
      }

      if (this.#mode !== 'secret') {
        const session = await this.#sessions.getSessionByBearerToken(bearerToken);
        if (session !== null) {
          return this.#principalFromSession(session);
        }
      }
      throw new AuthError('UNAUTHENTICATED', 'Valid authentication is required.', 401);
    }

    if (this.#mode !== 'secret' && this.#browserCookie !== undefined) {
      const sessionId = this.#browserCookie.read(input.cookieHeader);
      if (sessionId !== null) {
        const session = await this.#sessions.getSessionById(sessionId);
        if (session !== null) {
          return this.#principalFromSession(session);
        }
      }
    }

    throw new AuthError('UNAUTHENTICATED', 'Valid authentication is required.', 401);
  }

  async logout(cookieHeader: string | undefined): Promise<boolean> {
    if (this.#browserCookie === undefined) {
      return false;
    }
    const sessionId = this.#browserCookie.read(cookieHeader);
    return sessionId === null ? false : this.#sessions.revokeSession(sessionId);
  }

  #principalFromSession(session: SessionRecord): AuthenticatedPrincipal {
    if (session.actor.authMethod !== 'github' || session.githubCredentials === null) {
      throw new AuthError('UNAUTHENTICATED', 'Valid authentication is required.', 401);
    }
    return new AuthenticatedPrincipal({
      actor: session.actor,
      sessionId: session.id,
      githubCredentials: session.githubCredentials,
    });
  }
}
