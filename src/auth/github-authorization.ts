import type { GitHubCredentialSet } from '../sessions/github-credentials.js';

import { createGitHubActor, type ActorContext, type RepositoryPermission } from './actor.js';
import { AuthError } from './errors.js';

export interface VerifiedGitHubUser {
  readonly id: number;
  readonly login: string;
}

export interface GitHubAppRepositoryPermissions {
  readonly contents: 'none' | 'read' | 'write';
  readonly pullRequests: 'none' | 'read' | 'write';
}

export interface GitHubRepositoryAuthorization {
  readonly installationHasRepositoryAccess: boolean;
  readonly userPermission: RepositoryPermission;
  readonly appPermissions: GitHubAppRepositoryPermissions;
}

export interface GitHubAuthorizationGateway {
  verifyUser(accessToken: string): Promise<VerifiedGitHubUser>;
  getRepositoryAuthorization(
    accessToken: string,
    repository: string,
  ): Promise<GitHubRepositoryAuthorization>;
  isOrganizationMember?(accessToken: string, organization: string): Promise<boolean>;
  isTeamMember?(accessToken: string, organizationAndTeamSlug: string): Promise<boolean>;
}

export interface GitHubAuthorizationServiceOptions {
  readonly repository: string;
  readonly allowedOrganizations?: readonly string[];
  readonly allowedTeams?: readonly string[];
}

export class GitHubAuthorizationService {
  readonly #gateway: GitHubAuthorizationGateway;
  readonly #repository: string;
  readonly #allowedOrganizations: readonly string[];
  readonly #allowedTeams: readonly string[];

  constructor(gateway: GitHubAuthorizationGateway, options: GitHubAuthorizationServiceOptions) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
      throw new TypeError('GitHub repository must use owner/name format.');
    }
    this.#gateway = gateway;
    this.#repository = options.repository;
    this.#allowedOrganizations = Object.freeze([...(options.allowedOrganizations ?? [])]);
    this.#allowedTeams = Object.freeze([...(options.allowedTeams ?? [])]);
  }

  async authorize(credentials: GitHubCredentialSet): Promise<ActorContext> {
    const accessToken = credentials.getAccessToken();
    try {
      const [user, repositoryAccess] = await Promise.all([
        this.#gateway.verifyUser(accessToken),
        this.#gateway.getRepositoryAuthorization(accessToken, this.#repository),
      ]);

      await this.#enforceAllowlists(accessToken);

      const appCanRead =
        repositoryAccess.installationHasRepositoryAccess &&
        repositoryAccess.appPermissions.contents !== 'none';
      const appCanWrite =
        repositoryAccess.installationHasRepositoryAccess &&
        repositoryAccess.appPermissions.contents === 'write' &&
        repositoryAccess.appPermissions.pullRequests === 'write';
      const actor = createGitHubActor({
        githubUserId: user.id,
        githubLogin: user.login,
        repository: this.#repository,
        repositoryPermission: repositoryAccess.userPermission,
        appCanRead,
        appCanWrite,
      });
      if (!actor.canRead) {
        throw new AuthError('FORBIDDEN', 'Repository access is required.', 403);
      }
      return actor;
    } catch (cause) {
      if (cause instanceof AuthError) {
        throw cause;
      }
      throw new AuthError(
        'AUTH_PROVIDER_UNAVAILABLE',
        'GitHub authorization is temporarily unavailable.',
        503,
        { cause },
      );
    }
  }

  async #enforceAllowlists(accessToken: string): Promise<void> {
    if (this.#allowedOrganizations.length > 0) {
      const isOrganizationMember = this.#gateway.isOrganizationMember?.bind(this.#gateway);
      if (isOrganizationMember === undefined) {
        throw new AuthError('FORBIDDEN', 'Organization membership is required.', 403);
      }
      const memberships = await Promise.all(
        this.#allowedOrganizations.map((organization) =>
          isOrganizationMember(accessToken, organization),
        ),
      );
      if (!memberships.some(Boolean)) {
        throw new AuthError('FORBIDDEN', 'Organization membership is required.', 403);
      }
    }

    if (this.#allowedTeams.length > 0) {
      const isTeamMember = this.#gateway.isTeamMember?.bind(this.#gateway);
      if (isTeamMember === undefined) {
        throw new AuthError('FORBIDDEN', 'Team membership is required.', 403);
      }
      const memberships = await Promise.all(
        this.#allowedTeams.map((team) => isTeamMember(accessToken, team)),
      );
      if (!memberships.some(Boolean)) {
        throw new AuthError('FORBIDDEN', 'Team membership is required.', 403);
      }
    }
  }
}
