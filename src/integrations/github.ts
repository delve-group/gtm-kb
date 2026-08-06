import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import type { AppConfig } from '../config.js';
import type {
  GitHubAuthorizationGateway,
  GitHubRepositoryAuthorization,
  RepositoryPermission,
  VerifiedGitHubUser,
} from '../auth/index.js';
import type { GitHubClient } from '../github/index.js';
import type { Telemetry } from '../observability/index.js';
import { hashForTelemetry } from '../observability/index.js';

function permissionFromRepository(repository: {
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  } | null;
}): RepositoryPermission {
  const permissions = repository.permissions;
  if (permissions?.admin) return 'admin';
  if (permissions?.maintain) return 'maintain';
  if (permissions?.push) return 'write';
  if (permissions?.triage) return 'triage';
  if (permissions?.pull) return 'read';
  return 'none';
}

function appPermission(value: unknown): 'none' | 'read' | 'write' {
  return value === 'write' ? 'write' : value === 'read' ? 'read' : 'none';
}

function githubStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

export class OctokitGitHubAuthorizationGateway implements GitHubAuthorizationGateway {
  constructor(
    private readonly installationId: number,
    private readonly telemetry?: Telemetry,
  ) {}

  #client(accessToken: string): Octokit {
    return new Octokit({ auth: accessToken });
  }

  async verifyUser(accessToken: string): Promise<VerifiedGitHubUser> {
    const operation = async () => {
      const response = await this.#client(accessToken).rest.users.getAuthenticated();
      return { id: response.data.id, login: response.data.login };
    };
    return this.telemetry
      ? this.telemetry.observe(
          'auth.github.verify_user',
          {
            resultMetadata: (value) => {
              const user = value as VerifiedGitHubUser;
              return { github_user_id: user.id, github_login: user.login };
            },
          },
          operation,
        )
      : operation();
  }

  async getRepositoryAuthorization(
    accessToken: string,
    repositorySlug: string,
  ): Promise<GitHubRepositoryAuthorization> {
    const operation = async (): Promise<GitHubRepositoryAuthorization> => {
      const client = this.#client(accessToken);
      const installations = await client.paginate(
        client.rest.apps.listInstallationsForAuthenticatedUser,
        { per_page: 100 },
      );
      const installation = installations.find((entry) => entry.id === this.installationId);
      if (!installation) {
        return {
          installationHasRepositoryAccess: false,
          userPermission: 'none',
          appPermissions: { contents: 'none', pullRequests: 'none' },
        };
      }

      const repositories = await client.paginate(
        client.rest.apps.listInstallationReposForAuthenticatedUser,
        { installation_id: this.installationId, per_page: 100 },
      );
      const repository = repositories.find(
        (entry) => entry.full_name.toLowerCase() === repositorySlug.toLowerCase(),
      );
      const installationPermissions = installation.permissions as Record<string, unknown>;
      return {
        installationHasRepositoryAccess: repository !== undefined,
        userPermission: repository ? permissionFromRepository(repository) : 'none',
        appPermissions: {
          contents: appPermission(installationPermissions.contents),
          pullRequests: appPermission(installationPermissions.pull_requests),
        },
      };
    };
    return this.telemetry
      ? this.telemetry.observe(
          'auth.github.check_repository_permission',
          {
            metadata: { repository: repositorySlug },
            resultMetadata: (value) => {
              const authorization = value as GitHubRepositoryAuthorization;
              return {
                installation_has_repository_access: authorization.installationHasRepositoryAccess,
                repository_permission: authorization.userPermission,
                app_contents_permission: authorization.appPermissions.contents,
                app_pull_requests_permission: authorization.appPermissions.pullRequests,
              };
            },
          },
          operation,
        )
      : operation();
  }

  async isOrganizationMember(accessToken: string, organization: string): Promise<boolean> {
    const client = this.#client(accessToken);
    const user = await client.rest.users.getAuthenticated();
    try {
      await client.rest.orgs.checkMembershipForUser({
        org: organization,
        username: user.data.login,
      });
      return true;
    } catch (error) {
      if (githubStatus(error) === 404) return false;
      throw error;
    }
  }

  async isTeamMember(accessToken: string, organizationAndTeamSlug: string): Promise<boolean> {
    const [organization, teamSlug, extra] = organizationAndTeamSlug.split('/');
    if (!organization || !teamSlug || extra) return false;
    const client = this.#client(accessToken);
    const user = await client.rest.users.getAuthenticated();
    try {
      const membership = await client.rest.teams.getMembershipForUserInOrg({
        org: organization,
        team_slug: teamSlug,
        username: user.data.login,
      });
      return membership.data.state === 'active';
    } catch (error) {
      if (githubStatus(error) === 404) return false;
      throw error;
    }
  }
}

export function createInstallationOctokit(config: NonNullable<AppConfig['github']>): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: config.installationId,
    },
  });
}

export function createUserOctokit(accessToken: string): Octokit {
  return new Octokit({ auth: accessToken });
}

const observationByOperation: Record<string, string> = {
  getRef: 'github.resolve_base',
  getCommit: 'github.resolve_base',
  getTree: 'github.resolve_base',
  getBlob: 'github.resolve_base',
  createBlob: 'github.create_commit',
  createTree: 'github.create_commit',
  createCommit: 'github.create_commit',
  createRef: 'github.create_branch',
  list: 'proposal.detect_conflicts',
  listFiles: 'proposal.detect_conflicts',
  create: 'github.create_pull_request',
  get: 'github.read_checks',
  listForRef: 'github.read_checks',
  getCombinedStatusForRef: 'github.read_checks',
};

function safeParams(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return {};
  const params = value as Record<string, unknown>;
  const content = typeof params.content === 'string' ? params.content : undefined;
  return {
    ...Object.fromEntries(
      [
        'owner',
        'repo',
        'ref',
        'commit_sha',
        'tree_sha',
        'file_sha',
        'base',
        'head',
        'pull_number',
      ].flatMap((key) => (params[key] === undefined ? [] : [[key, params[key]]])),
    ),
    ...(content === undefined
      ? {}
      : { content_bytes: Buffer.byteLength(content), content_hash: hashForTelemetry(content) }),
  };
}

function instrumentNamespace<T extends object>(
  namespace: T,
  telemetry: Telemetry,
  namespaceName: string,
): T {
  return new Proxy(namespace, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      return (...args: unknown[]) =>
        telemetry.observe(
          observationByOperation[property] ?? `github.${namespaceName}.${property}`,
          {
            metadata: { operation: property, ...safeParams(args[0]) },
            resultMetadata: () => ({ success: true }),
          },
          () => Reflect.apply(value, target, args) as Promise<unknown>,
        );
    },
  });
}

export function asInstrumentedGitHubClient(octokit: Octokit, telemetry: Telemetry): GitHubClient {
  const rest = octokit.rest;
  return {
    git: instrumentNamespace(rest.git, telemetry, 'git'),
    pulls: instrumentNamespace(rest.pulls, telemetry, 'pulls'),
    checks: instrumentNamespace(rest.checks, telemetry, 'checks'),
    repos: instrumentNamespace(rest.repos, telemetry, 'repos'),
  };
}

export function githubConnectivityCheck(
  octokit: Octokit,
  config: NonNullable<AppConfig['github']>,
): () => Promise<{ status: 'connected' | 'unavailable'; checked_at: string; message?: string }> {
  return async () => {
    const checkedAt = new Date().toISOString();
    try {
      await octokit.rest.repos.get({ owner: config.owner, repo: config.repository });
      return { status: 'connected', checked_at: checkedAt };
    } catch {
      return {
        status: 'unavailable',
        checked_at: checkedAt,
        message: 'GitHub repository connectivity check failed.',
      };
    }
  };
}
