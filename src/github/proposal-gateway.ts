import type { ActorContext, GitHubAuthorizationService, GitHubOAuthClient } from '../auth/index.js';
import type { BrainKernel, BrainValidationReport } from '../brain/index.js';
import { AppError } from '../errors.js';
import { asInstrumentedGitHubClient, createUserOctokit } from '../integrations/github.js';
import type { ProposalGateway } from '../mcp/index.js';
import type { Telemetry } from '../observability/index.js';
import type { GitHubCredentialSet, SessionStore } from '../sessions/index.js';
import { GitHubProposalService } from './proposal-service.js';
import type {
  CreateProposalRequest,
  GetProposalInput,
  GitHubClient,
  ProposalStore,
  ProposalValidationResult,
} from './types.js';

export interface GitHubProposalGatewayOptions {
  readonly owner: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly brainRoot: string;
  readonly validationRoots?: readonly string[];
  readonly sessions: SessionStore;
  readonly proposalStore: ProposalStore;
  readonly brain: BrainKernel;
  readonly oauth: GitHubOAuthClient;
  readonly authorization: GitHubAuthorizationService;
  readonly telemetry: Telemetry;
  readonly installationClient: GitHubClient;
  readonly refreshLeewaySeconds?: number;
}

function validationResult(report: BrainValidationReport): ProposalValidationResult {
  const issues = report.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    severity: issue.severity,
    ...(issue.path === undefined ? {} : { path: issue.path }),
  }));
  return {
    valid: report.valid,
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    summary: `${String(report.errors)} error(s), ${String(report.warnings)} warning(s), ${String(report.conceptCount)} concept(s)`,
  };
}

export class GitHubProposalGateway implements ProposalGateway {
  readonly #refreshLeewayMs: number;

  constructor(private readonly options: GitHubProposalGatewayOptions) {
    this.#refreshLeewayMs = (options.refreshLeewaySeconds ?? 120) * 1000;
  }

  async createProposal(
    request: Omit<CreateProposalRequest, 'actor'>,
    actor: ActorContext,
    sessionId: string,
  ) {
    if (
      actor.authMethod !== 'github' ||
      actor.githubUserId === undefined ||
      actor.githubLogin === undefined ||
      !actor.canWrite
    ) {
      throw new AppError(
        'FORBIDDEN',
        'An authenticated GitHub user with repository write access is required.',
      );
    }
    const credentials = await this.#credentials(sessionId, actor);
    const verifiedActor = await this.options.authorization.authorize(credentials);
    if (
      verifiedActor.githubUserId !== actor.githubUserId ||
      !verifiedActor.githubLogin ||
      !verifiedActor.canWrite
    ) {
      throw new AppError(
        'FORBIDDEN',
        'The GitHub user no longer has repository proposal permission.',
      );
    }
    const client = asInstrumentedGitHubClient(
      createUserOctokit(credentials.getAccessToken()),
      this.options.telemetry,
    );
    return this.#service(client).createProposal({
      ...request,
      actor: {
        githubUserId: verifiedActor.githubUserId,
        githubLogin: verifiedActor.githubLogin,
      },
    });
  }

  async getProposal(input: GetProposalInput, actor: ActorContext) {
    if (!actor.canRead) throw new AppError('FORBIDDEN', 'Repository read access is required.');
    return this.#service(this.options.installationClient).getProposal(input);
  }

  #service(github: GitHubClient): GitHubProposalService {
    return new GitHubProposalService(
      {
        owner: this.options.owner,
        repository: this.options.repository,
        defaultBranch: this.options.defaultBranch,
        brainRoot: this.options.brainRoot,
        ...(this.options.validationRoots === undefined
          ? {}
          : { validationRoots: this.options.validationRoots }),
      },
      {
        github,
        store: this.options.proposalStore,
        validateCandidate: (candidateFiles) =>
          this.options.telemetry.observe(
            'brain.validate',
            {
              metadata: { candidate_file_count: candidateFiles.size },
              resultMetadata: (value) => {
                const result = value as ProposalValidationResult;
                return {
                  valid: result.valid,
                  validation_error_count: result.errors.length,
                  validation_warning_count: result.warnings.length,
                };
              },
            },
            () =>
              Promise.resolve(
                validationResult(this.options.brain.validateCandidateFiles(candidateFiles)),
              ),
          ),
      },
    );
  }

  async #credentials(sessionId: string, actor: ActorContext): Promise<GitHubCredentialSet> {
    const session = await this.options.sessions.getSessionById(sessionId);
    if (
      session?.actor.authMethod !== 'github' ||
      session.actor.githubUserId !== actor.githubUserId ||
      !session.githubCredentials
    ) {
      throw new AppError('UNAUTHENTICATED', 'The GitHub session is invalid or expired.');
    }

    let credentials = session.githubCredentials;
    const expiresAt = credentials.accessTokenExpiresAt?.getTime();
    if (expiresAt !== undefined && expiresAt <= Date.now() + this.#refreshLeewayMs) {
      const previousAccessToken = credentials.getAccessToken();
      if (credentials.getRefreshToken() === undefined) {
        if (expiresAt <= Date.now()) {
          throw new AppError('UNAUTHENTICATED', 'The GitHub session requires reauthorization.');
        }
        return credentials;
      }

      const refreshed = await this.options.telemetry.observe(
        'auth.github.refresh_token',
        {
          metadata: {
            github_user_id: actor.githubUserId,
            github_login: actor.githubLogin,
            repository: actor.repository,
          },
          resultMetadata: () => ({ refreshed: true }),
        },
        async () => this.options.oauth.refresh(credentials),
      );
      const updated = await this.options.sessions.updateGitHubCredentials(
        sessionId,
        refreshed,
        previousAccessToken,
      );
      if (updated) return refreshed;

      const reloadedSession = await this.options.sessions.getSessionById(sessionId);
      if (!reloadedSession?.githubCredentials) {
        throw new AppError('UNAUTHENTICATED', 'The GitHub session is invalid or expired.');
      }
      credentials = reloadedSession.githubCredentials;
    }
    return credentials;
  }
}
