import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  GitHubProposalError,
  githubHttpStatus,
  isGitHubProposalError,
  type GitHubProposalErrorCode,
} from './errors.js';
import type {
  CandidateValidationContext,
  ChecksStatus,
  CommitStatus,
  ConflictState,
  CreateProposalRequest,
  CreateProposalResult,
  GetProposalInput,
  GitHubClient,
  Mergeability,
  OpenBrainProposal,
  ProposalChange,
  ProposalConflict,
  ProposalLifecycleStatus,
  ProposalRecord,
  ProposalServiceConfig,
  ProposalServiceDependencies,
  ProposalStatusResult,
  ProposalValidationResult,
  ValidationIssue,
} from './types.js';

const PAGE_SIZE = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_RATIONALE_LENGTH = 10_000;
const MAX_CHANGES = 100;
const MAX_CONTENT_LENGTH = 1_000_000;

interface NormalizedConfig {
  readonly owner: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly brainRoot: string;
  readonly validationRoots: readonly string[];
  readonly branchPrefix: string;
  readonly maxOpenProposalPages: number;
}

interface RepositorySnapshot {
  readonly treeSha: string;
  readonly files: ReadonlyMap<string, string>;
  readonly blobShas: ReadonlyMap<string, string>;
}

interface CandidateSnapshot {
  readonly files: ReadonlyMap<string, string>;
  readonly baseFiles: ReadonlyMap<string, string>;
}

type Transition = (patch: Partial<ProposalRecord>) => Promise<void>;

export class GitHubProposalService {
  readonly #config: NormalizedConfig;
  readonly #github: GitHubClient;
  readonly #store: ProposalServiceDependencies['store'];
  readonly #validateCandidate: ProposalServiceDependencies['validateCandidate'];
  readonly #detectSemanticConflicts:
    ProposalServiceDependencies['detectSemanticConflicts'] | undefined;
  readonly #now: () => Date;
  readonly #createProposalId: () => string;
  readonly #createBranchNonce: () => string;

  constructor(config: ProposalServiceConfig, dependencies: ProposalServiceDependencies) {
    this.#config = normalizeConfig(config);
    this.#github = dependencies.github;
    this.#store = dependencies.store;
    this.#validateCandidate = dependencies.validateCandidate;
    this.#detectSemanticConflicts = dependencies.detectSemanticConflicts;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createProposalId = dependencies.createProposalId ?? randomUUID;
    this.#createBranchNonce =
      dependencies.createBranchNonce ?? (() => randomBytes(5).toString('hex'));
  }

  async createProposal(request: CreateProposalRequest): Promise<CreateProposalResult> {
    const normalized = normalizeRequest(request, this.#config.brainRoot);
    const proposalId = this.#createProposalId();
    if (!proposalId || proposalId.length > 128 || /[\s\0]/u.test(proposalId)) {
      throw new GitHubProposalError(
        'INTERNAL_ERROR',
        'A proposal identifier could not be created.',
      );
    }

    const createdAt = this.#now().toISOString();
    const branch = this.#buildUniqueBranch(normalized.actor.githubLogin, normalized.title);
    let record: ProposalRecord = {
      id: proposalId,
      actor: normalized.actor,
      owner: this.#config.owner,
      repository: this.#config.repository,
      defaultBranch: this.#config.defaultBranch,
      baseSha: normalized.baseSha,
      title: normalized.title,
      rationale: normalized.rationale,
      changes: normalized.changes.map(({ operation, path }) => ({ operation, path })),
      createdAt,
      updatedAt: createdAt,
      status: 'preparing',
      branch,
    };

    try {
      await this.#store.create(record);
    } catch (cause) {
      throw new GitHubProposalError(
        'INTERNAL_ERROR',
        'The proposal could not be recorded.',
        { proposalId },
        cause,
      );
    }

    const transition: Transition = async (patch) => {
      const updatedAt = this.#now().toISOString();
      record = { ...record, ...patch, updatedAt };
      // Persist the complete receipt on every transition. If a previous store write was
      // transiently lost after a GitHub write, the next transition still records all
      // known partial artifacts (commit, branch, and PR), not just the latest status.
      await this.#store.update(proposalId, record);
    };

    try {
      await this.#assertCurrentDefaultHead(normalized.baseSha);
      const snapshot = await this.#loadSnapshot(normalized.baseSha);
      const candidate = this.#applyChanges(snapshot, normalized.changes);

      await transition({ status: 'validating' });
      const validationContext: CandidateValidationContext = {
        proposalId,
        owner: this.#config.owner,
        repository: this.#config.repository,
        brainRoot: this.#config.brainRoot,
        baseSha: normalized.baseSha,
        actor: normalized.actor,
        changes: normalized.changes,
        baseFiles: candidate.baseFiles,
      };
      const validation = await this.#runValidation(candidate.files, validationContext);
      const validationConflicts = conflictsFromValidation(validation.errors);

      if (!validation.valid) {
        if (validationConflicts.length > 0) {
          await transition({
            status: 'conflict',
            validation,
            conflicts: validationConflicts,
            failure: {
              code: 'GIT_CONFLICT',
              message: 'The candidate contains a semantic conflict.',
            },
          });
          throw new GitHubProposalError(
            'GIT_CONFLICT',
            'The proposed knowledge changes conflict with active company knowledge.',
            { proposalId, conflicts: validationConflicts },
          );
        }

        await transition({
          status: 'rejected',
          validation,
          failure: {
            code: 'VALIDATION_FAILED',
            message: 'The candidate Company Brain did not pass validation.',
          },
        });
        throw new GitHubProposalError(
          'VALIDATION_FAILED',
          'The proposed Company Brain changes did not pass validation.',
          {
            proposalId,
            errorCount: validation.errors.length,
            warningCount: validation.warnings.length,
          },
        );
      }

      const openProposals = await this.#listOpenBrainProposals();
      const conflicts = await this.#detectConflicts(openProposals, candidate, validationContext);
      if (conflicts.length > 0) {
        await transition({
          status: 'conflict',
          validation,
          conflicts,
          failure: {
            code: 'GIT_CONFLICT',
            message: 'The proposal overlaps another open Company Brain proposal.',
          },
        });
        throw new GitHubProposalError(
          'GIT_CONFLICT',
          'The proposal conflicts with another open Company Brain proposal.',
          { proposalId, conflicts },
        );
      }

      // Close the read/validation race as far as GitHub's API permits. A later default-
      // branch movement remains visible as normal PR mergeability, never an overwrite.
      await this.#assertCurrentDefaultHead(normalized.baseSha);
      await transition({ status: 'writing', validation });

      const treeItems: {
        path: string;
        mode: '100644';
        type: 'blob';
        sha: string | null;
      }[] = [];
      for (const change of normalized.changes) {
        if (change.operation === 'delete') {
          treeItems.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
          continue;
        }

        const blob = await this.#githubCall('github.create_blob', () =>
          this.#github.git.createBlob({
            owner: this.#config.owner,
            repo: this.#config.repository,
            content: change.content ?? '',
            encoding: 'utf-8',
          }),
        );
        treeItems.push({
          path: change.path,
          mode: '100644',
          type: 'blob',
          sha: blob.data.sha,
        });
      }

      const newTree = await this.#githubCall('github.create_tree', () =>
        this.#github.git.createTree({
          owner: this.#config.owner,
          repo: this.#config.repository,
          base_tree: snapshot.treeSha,
          tree: treeItems,
        }),
      );
      const commit = await this.#githubCall('github.create_commit', () =>
        this.#github.git.createCommit({
          owner: this.#config.owner,
          repo: this.#config.repository,
          message: buildCommitMessage(normalized.title, proposalId, normalized.actor.githubLogin),
          tree: newTree.data.sha,
          parents: [normalized.baseSha],
        }),
      );
      await transition({ status: 'commit_created', commitSha: commit.data.sha });

      await this.#githubCall(
        'github.create_branch',
        () =>
          this.#github.git.createRef({
            owner: this.#config.owner,
            repo: this.#config.repository,
            ref: `refs/heads/${branch}`,
            sha: commit.data.sha,
          }),
        new Set([409, 422]),
      );
      await transition({ status: 'branch_created' });

      const pullRequest = await this.#githubCall(
        'github.create_pull_request',
        () =>
          this.#github.pulls.create({
            owner: this.#config.owner,
            repo: this.#config.repository,
            title: `[Company Brain] ${normalized.title}`,
            head: branch,
            base: this.#config.defaultBranch,
            body: buildPullRequestBody({
              proposalId,
              request: normalized,
              validation,
              brainRoot: this.#config.brainRoot,
            }),
            draft: true,
          }),
        new Set([409, 422]),
      );

      await transition({
        status: 'pr_opened',
        pullRequestNumber: pullRequest.data.number,
        pullRequestUrl: pullRequest.data.html_url,
      });

      return {
        proposalId,
        branch,
        commitSha: commit.data.sha,
        pullRequestNumber: pullRequest.data.number,
        pullRequestUrl: pullRequest.data.html_url,
        validation,
      };
    } catch (error) {
      const mapped = isGitHubProposalError(error)
        ? error
        : new GitHubProposalError(
            'INTERNAL_ERROR',
            'The proposal could not be completed.',
            { proposalId },
            error,
          );
      await this.#persistFailureBestEffort(record, transition, mapped);
      throw mapped;
    }
  }

  async getProposal(input: GetProposalInput): Promise<ProposalStatusResult> {
    const record = await this.#findProposal(input);
    const storedConflicts = record.conflicts ?? [];

    const storedPullRequestNumber = record.pullRequestNumber;
    if (storedPullRequestNumber === undefined) {
      return proposalStatusFromRecord(record, {
        mergeability: 'unknown',
        checksStatus: 'unknown',
        commitStatus: 'unknown',
        conflictState: storedConflicts.length > 0 ? 'conflict' : 'unknown',
        conflicts: storedConflicts,
      });
    }

    const pullRequest = await this.#githubCall(
      'github.read_pull_request',
      () =>
        this.#github.pulls.get({
          owner: this.#config.owner,
          repo: this.#config.repository,
          pull_number: storedPullRequestNumber,
        }),
      undefined,
      'NOT_FOUND',
    );
    const statusRef = pullRequest.data.head.sha;
    const [checksResult, commitStatusResult] = await Promise.allSettled([
      this.#github.checks.listForRef({
        owner: this.#config.owner,
        repo: this.#config.repository,
        ref: statusRef,
        per_page: PAGE_SIZE,
      }),
      this.#github.repos.getCombinedStatusForRef({
        owner: this.#config.owner,
        repo: this.#config.repository,
        ref: statusRef,
      }),
    ]);

    const mergeability = summarizeMergeability(
      pullRequest.data.mergeable,
      pullRequest.data.mergeable_state,
    );
    const githubConflict =
      mergeability === 'conflicting'
        ? [
            {
              kind: 'github_merge_conflict' as const,
              message: 'GitHub reports that the pull request is not mergeable.',
              pullRequestNumber: pullRequest.data.number,
            },
          ]
        : [];
    const conflicts = [...storedConflicts, ...githubConflict];
    const conflictState: ConflictState =
      conflicts.length > 0 ? 'conflict' : mergeability === 'mergeable' ? 'clean' : 'unknown';
    const lifecycle = pullRequest.data.merged
      ? 'merged'
      : pullRequest.data.state === 'closed'
        ? 'closed'
        : 'open';

    return proposalStatusFromRecord(record, {
      lifecycle,
      mergeability,
      ...(pullRequest.data.mergeable_state
        ? { githubMergeableState: pullRequest.data.mergeable_state }
        : {}),
      checksStatus:
        checksResult.status === 'fulfilled'
          ? summarizeChecks(checksResult.value.data.check_runs)
          : 'unknown',
      commitStatus:
        commitStatusResult.status === 'fulfilled'
          ? summarizeCommitStatus(commitStatusResult.value.data.state)
          : 'unknown',
      conflictState,
      conflicts,
      pullRequestUrl: pullRequest.data.html_url,
    });
  }

  async #findProposal(input: GetProposalInput): Promise<ProposalRecord> {
    const hasId = typeof input.proposalId === 'string' && input.proposalId.trim().length > 0;
    const hasPullRequest = input.pullRequestNumber !== undefined;
    if (hasId === hasPullRequest) {
      throw new GitHubProposalError(
        'INVALID_INPUT',
        'Provide exactly one proposal ID or pull-request number.',
      );
    }

    let record: ProposalRecord | undefined;
    if (hasId) {
      record = await this.#store.getById(input.proposalId);
    } else {
      const pullRequestNumber = input.pullRequestNumber;
      if (
        pullRequestNumber === undefined ||
        !Number.isSafeInteger(pullRequestNumber) ||
        pullRequestNumber <= 0
      ) {
        throw new GitHubProposalError(
          'INVALID_INPUT',
          'The pull-request number must be a positive integer.',
        );
      }
      record = await this.#store.getByPullRequestNumber(pullRequestNumber);
    }

    if (!record) {
      throw new GitHubProposalError('NOT_FOUND', 'The requested proposal was not found.');
    }
    return record;
  }

  async #assertCurrentDefaultHead(expectedSha: string): Promise<void> {
    const head = await this.#githubCall('github.resolve_base', () =>
      this.#github.git.getRef({
        owner: this.#config.owner,
        repo: this.#config.repository,
        ref: `heads/${this.#config.defaultBranch}`,
      }),
    );
    if (head.data.object.sha.toLowerCase() !== expectedSha.toLowerCase()) {
      throw new GitHubProposalError(
        'STALE_BASE',
        'The default branch moved after the proposal base was selected.',
        {
          expectedBaseSha: expectedSha,
          currentBaseSha: head.data.object.sha,
          defaultBranch: this.#config.defaultBranch,
        },
      );
    }
  }

  async #loadSnapshot(baseSha: string): Promise<RepositorySnapshot> {
    const commit = await this.#githubCall(
      'github.read_base_commit',
      () =>
        this.#github.git.getCommit({
          owner: this.#config.owner,
          repo: this.#config.repository,
          commit_sha: baseSha,
        }),
      undefined,
      'STALE_BASE',
    );
    if (commit.data.sha.toLowerCase() !== baseSha.toLowerCase()) {
      throw new GitHubProposalError(
        'STALE_BASE',
        'GitHub did not resolve the exact requested base commit.',
        { expectedBaseSha: baseSha },
      );
    }

    const tree = await this.#githubCall('github.read_tree', () =>
      this.#github.git.getTree({
        owner: this.#config.owner,
        repo: this.#config.repository,
        tree_sha: commit.data.tree.sha,
        recursive: 'true',
      }),
    );
    if (tree.data.truncated) {
      throw new GitHubProposalError(
        'GITHUB_UNAVAILABLE',
        'The repository tree is too large to validate safely in one proposal.',
      );
    }

    const fileEntries = tree.data.tree.filter(
      (entry): entry is { path: string; sha: string; type: string; mode?: string } =>
        entry.type === 'blob' &&
        typeof entry.sha === 'string' &&
        isWithinAnyRoot(entry.path, this.#config.validationRoots),
    );
    const blobPairs = await Promise.all(
      fileEntries.map(async (entry) => {
        const blob = await this.#githubCall('github.read_blob', () =>
          this.#github.git.getBlob({
            owner: this.#config.owner,
            repo: this.#config.repository,
            file_sha: entry.sha,
          }),
        );
        if (blob.data.encoding !== 'base64') {
          throw new GitHubProposalError(
            'GITHUB_UNAVAILABLE',
            'A repository file could not be decoded for validation.',
            { path: entry.path },
          );
        }
        return [
          entry.path,
          {
            content: Buffer.from(blob.data.content.replace(/\s/gu, ''), 'base64').toString('utf8'),
            sha: entry.sha,
          },
        ] as const;
      }),
    );

    return {
      treeSha: commit.data.tree.sha,
      files: new Map(blobPairs.map(([path, blob]) => [path, blob.content])),
      blobShas: new Map(blobPairs.map(([path, blob]) => [path, blob.sha])),
    };
  }

  #applyChanges(
    snapshot: RepositorySnapshot,
    changes: readonly ProposalChange[],
  ): CandidateSnapshot {
    const baseFiles = new Map(snapshot.files);
    const candidateFiles = new Map(snapshot.files);

    for (const change of changes) {
      const previousContent = baseFiles.get(change.path);
      const previousBlobSha = snapshot.blobShas.get(change.path);
      const exists = previousContent !== undefined;

      if (change.expectedBlobSha !== undefined) {
        if (previousBlobSha?.toLowerCase() !== change.expectedBlobSha.toLowerCase()) {
          throw new GitHubProposalError(
            'GIT_CONFLICT',
            'A file changed after its expected Git blob was selected.',
            { path: change.path, expectation: 'blob_sha' },
          );
        }
      }
      if (change.expectedContentSha256 !== undefined) {
        const actual = previousContent === undefined ? undefined : sha256(previousContent);
        if (actual?.toLowerCase() !== change.expectedContentSha256.toLowerCase()) {
          throw new GitHubProposalError(
            'GIT_CONFLICT',
            'A file changed after its expected content hash was selected.',
            { path: change.path, expectation: 'content_sha256' },
          );
        }
      }

      if (change.operation === 'create') {
        if (exists) {
          throw new GitHubProposalError(
            'GIT_CONFLICT',
            'A create operation targeted a path that already exists.',
            { path: change.path },
          );
        }
        candidateFiles.set(change.path, change.content ?? '');
      } else if (change.operation === 'update') {
        if (!exists) {
          throw new GitHubProposalError(
            'GIT_CONFLICT',
            'An update operation targeted a path that no longer exists.',
            { path: change.path },
          );
        }
        candidateFiles.set(change.path, change.content ?? '');
      } else {
        if (!exists) {
          throw new GitHubProposalError(
            'GIT_CONFLICT',
            'A delete operation targeted a path that no longer exists.',
            { path: change.path },
          );
        }
        candidateFiles.delete(change.path);
      }
    }

    return { files: candidateFiles, baseFiles };
  }

  async #runValidation(
    candidateFiles: ReadonlyMap<string, string>,
    context: CandidateValidationContext,
  ): Promise<ProposalValidationResult> {
    let result: unknown;
    try {
      result = await this.#validateCandidate(candidateFiles, context);
    } catch (cause) {
      throw new GitHubProposalError(
        'VALIDATION_FAILED',
        'The candidate Company Brain could not be validated.',
        { proposalId: context.proposalId },
        cause,
      );
    }

    if (!isProposalValidationResult(result)) {
      throw new GitHubProposalError(
        'VALIDATION_FAILED',
        'The Company Brain validator returned an invalid result.',
        { proposalId: context.proposalId },
      );
    }
    return result;
  }

  async #listOpenBrainProposals(): Promise<readonly OpenBrainProposal[]> {
    const proposals: OpenBrainProposal[] = [];
    for (let page = 1; page <= this.#config.maxOpenProposalPages; page += 1) {
      const response = await this.#githubCall('github.list_open_pull_requests', () =>
        this.#github.pulls.list({
          owner: this.#config.owner,
          repo: this.#config.repository,
          state: 'open',
          base: this.#config.defaultBranch,
          per_page: PAGE_SIZE,
          page,
        }),
      );

      for (const pullRequest of response.data) {
        if (!pullRequest.head.ref.startsWith(`${this.#config.branchPrefix}/`)) {
          continue;
        }
        proposals.push({
          number: pullRequest.number,
          ...(pullRequest.html_url ? { url: pullRequest.html_url } : {}),
          branch: pullRequest.head.ref,
          changedPaths: await this.#listPullRequestFiles(pullRequest.number),
        });
      }

      if (response.data.length < PAGE_SIZE) {
        return proposals;
      }
    }

    throw new GitHubProposalError(
      'GITHUB_UNAVAILABLE',
      'There are too many open pull requests to check proposal conflicts safely.',
    );
  }

  async #listPullRequestFiles(pullRequestNumber: number): Promise<readonly string[]> {
    const paths: string[] = [];
    for (let page = 1; page <= this.#config.maxOpenProposalPages; page += 1) {
      const response = await this.#githubCall('github.list_pull_request_files', () =>
        this.#github.pulls.listFiles({
          owner: this.#config.owner,
          repo: this.#config.repository,
          pull_number: pullRequestNumber,
          per_page: PAGE_SIZE,
          page,
        }),
      );
      paths.push(...response.data.map(({ filename }) => filename));
      if (response.data.length < PAGE_SIZE) {
        return paths;
      }
    }

    throw new GitHubProposalError(
      'GITHUB_UNAVAILABLE',
      'A pull request changes too many files to check conflicts safely.',
      { pullRequestNumber },
    );
  }

  async #detectConflicts(
    openProposals: readonly OpenBrainProposal[],
    candidate: CandidateSnapshot,
    validationContext: CandidateValidationContext,
  ): Promise<readonly ProposalConflict[]> {
    const targetPaths = new Set(validationContext.changes.map(({ path }) => path));
    const conflicts: ProposalConflict[] = [];
    for (const proposal of openProposals) {
      for (const path of proposal.changedPaths) {
        if (targetPaths.has(path)) {
          conflicts.push({
            kind: 'overlapping_path',
            message: 'Another open Company Brain proposal changes the same path.',
            path,
            pullRequestNumber: proposal.number,
          });
        }
      }
    }

    if (this.#detectSemanticConflicts) {
      try {
        conflicts.push(
          ...(await this.#detectSemanticConflicts({
            ...validationContext,
            candidateFiles: candidate.files,
            openProposals,
          })),
        );
      } catch (cause) {
        throw new GitHubProposalError(
          'VALIDATION_FAILED',
          'Semantic proposal conflicts could not be checked safely.',
          { proposalId: validationContext.proposalId },
          cause,
        );
      }
    }
    return deduplicateConflicts(conflicts);
  }

  #buildUniqueBranch(login: string, title: string): string {
    const timestamp = this.#now()
      .toISOString()
      .replace(/[-:.TZ]/gu, '')
      .slice(0, 14);
    const actor = slugify(login, 39) || 'github-user';
    const titleSlug = slugify(title, 48) || 'change';
    const nonce = slugify(this.#createBranchNonce(), 16);
    if (!nonce) {
      throw new GitHubProposalError(
        'INTERNAL_ERROR',
        'A unique proposal branch could not be created.',
      );
    }
    return `${this.#config.branchPrefix}/${actor}/${timestamp}-${titleSlug}-${nonce}`;
  }

  async #githubCall<T>(
    operation: string,
    call: () => Promise<T>,
    conflictStatuses?: ReadonlySet<number>,
    notFoundCode?: GitHubProposalErrorCode,
  ): Promise<T> {
    try {
      return await call();
    } catch (cause) {
      if (isGitHubProposalError(cause)) {
        throw cause;
      }
      const status = githubHttpStatus(cause);
      if (status !== undefined && conflictStatuses?.has(status)) {
        throw new GitHubProposalError(
          'GIT_CONFLICT',
          'GitHub rejected a concurrent proposal update.',
          { operation },
          cause,
        );
      }
      if (status === 404 && notFoundCode) {
        throw new GitHubProposalError(
          notFoundCode,
          notFoundCode === 'NOT_FOUND'
            ? 'The requested GitHub proposal resource was not found.'
            : 'The selected base commit is no longer available.',
          { operation },
          cause,
        );
      }
      throw new GitHubProposalError(
        'GITHUB_UNAVAILABLE',
        'GitHub is temporarily unavailable for proposal processing.',
        { operation },
        cause,
      );
    }
  }

  async #persistFailureBestEffort(
    record: ProposalRecord,
    transition: Transition,
    error: GitHubProposalError,
  ): Promise<void> {
    if (['stale', 'rejected', 'conflict'].includes(record.status)) {
      return;
    }
    const status: ProposalLifecycleStatus =
      error.code === 'STALE_BASE'
        ? 'stale'
        : error.code === 'VALIDATION_FAILED'
          ? 'rejected'
          : error.code === 'GIT_CONFLICT'
            ? 'conflict'
            : 'failed';
    try {
      await transition({
        status,
        failure: { code: error.code, message: error.message },
      });
    } catch {
      // The original safe error remains more useful than masking it with a store failure.
    }
  }
}

function normalizeConfig(config: ProposalServiceConfig): NormalizedConfig {
  const owner = requireSimpleName(config.owner, 'GitHub owner');
  const repository = requireSimpleName(config.repository, 'GitHub repository');
  const defaultBranch = requireSafeRef(config.defaultBranch, 'default branch');
  const brainRoot = normalizeRoot(config.brainRoot, 'brain root');
  const branchPrefix = requireSafeRef(config.branchPrefix ?? 'brain', 'branch prefix');
  const validationRoots = Array.from(
    new Set([
      brainRoot,
      ...(config.validationRoots ?? []).map((root) => normalizeRoot(root, 'validation root')),
    ]),
  );
  const maxOpenProposalPages = config.maxOpenProposalPages ?? 10;
  if (!Number.isSafeInteger(maxOpenProposalPages) || maxOpenProposalPages < 1) {
    throw new GitHubProposalError(
      'INVALID_INPUT',
      'maxOpenProposalPages must be a positive integer.',
    );
  }
  return {
    owner,
    repository,
    defaultBranch,
    brainRoot,
    validationRoots,
    branchPrefix,
    maxOpenProposalPages,
  };
}

function normalizeRequest(
  request: CreateProposalRequest,
  brainRoot: string,
): CreateProposalRequest {
  if (!/^[0-9a-f]{40,64}$/iu.test(request.baseSha)) {
    throw new GitHubProposalError('INVALID_INPUT', 'base_sha must be a full Git commit SHA.');
  }
  const title = request.title.trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new GitHubProposalError(
      'INVALID_INPUT',
      `The proposal title must contain 1-${String(MAX_TITLE_LENGTH)} characters.`,
    );
  }
  const rationale = request.rationale.trim();
  if (!rationale || rationale.length > MAX_RATIONALE_LENGTH) {
    throw new GitHubProposalError(
      'INVALID_INPUT',
      `The proposal rationale must contain 1-${String(MAX_RATIONALE_LENGTH)} characters.`,
    );
  }
  if (
    !Number.isSafeInteger(request.actor.githubUserId) ||
    request.actor.githubUserId <= 0 ||
    !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu.test(request.actor.githubLogin)
  ) {
    throw new GitHubProposalError('INVALID_INPUT', 'The verified GitHub actor is invalid.');
  }
  if (request.changes.length < 1 || request.changes.length > MAX_CHANGES) {
    throw new GitHubProposalError(
      'INVALID_INPUT',
      `A proposal must contain 1-${String(MAX_CHANGES)} explicit changes.`,
    );
  }

  const seen = new Set<string>();
  const changes = request.changes.map((change) => {
    const path = normalizeWritePath(change.path, brainRoot);
    if (seen.has(path)) {
      throw new GitHubProposalError(
        'INVALID_INPUT',
        'A proposal cannot change the same path more than once.',
        { path },
      );
    }
    seen.add(path);
    if (!(['create', 'update', 'delete'] as const).includes(change.operation)) {
      throw new GitHubProposalError('INVALID_INPUT', 'A change operation is invalid.', { path });
    }
    if (change.operation === 'delete') {
      if (change.content !== undefined) {
        throw new GitHubProposalError(
          'INVALID_INPUT',
          'Delete operations must not include content.',
          { path },
        );
      }
    } else if (typeof change.content !== 'string') {
      throw new GitHubProposalError(
        'INVALID_INPUT',
        'Create and update operations require exact string content.',
        { path },
      );
    } else if (change.content.length > MAX_CONTENT_LENGTH) {
      throw new GitHubProposalError(
        'INVALID_INPUT',
        `Change content cannot exceed ${String(MAX_CONTENT_LENGTH)} characters.`,
        { path },
      );
    }
    if (
      change.expectedContentSha256 !== undefined &&
      !/^[0-9a-f]{64}$/iu.test(change.expectedContentSha256)
    ) {
      throw new GitHubProposalError(
        'INVALID_INPUT',
        'An expected content hash must be a hexadecimal SHA-256.',
        { path },
      );
    }
    if (
      change.expectedBlobSha !== undefined &&
      !/^[0-9a-f]{40,64}$/iu.test(change.expectedBlobSha)
    ) {
      throw new GitHubProposalError(
        'INVALID_INPUT',
        'An expected blob SHA must be a full hexadecimal Git SHA.',
        { path },
      );
    }
    return { ...change, path };
  });

  return {
    baseSha: request.baseSha.toLowerCase(),
    title,
    rationale,
    actor: {
      githubUserId: request.actor.githubUserId,
      githubLogin: request.actor.githubLogin,
    },
    changes,
  };
}

function normalizeWritePath(path: string, brainRoot: string): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) {
    throw new GitHubProposalError('INVALID_INPUT', 'A repository path is invalid.');
  }
  if (
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('\\') ||
    hasControlCharacters(path)
  ) {
    throw new GitHubProposalError('INVALID_INPUT', 'A repository path is unsafe.');
  }
  const segments = path.split('/');
  if (
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.toLowerCase() === '.git',
    )
  ) {
    throw new GitHubProposalError('INVALID_INPUT', 'A repository path is unsafe.');
  }
  if (!isWithinRoot(path, brainRoot) || path === brainRoot) {
    throw new GitHubProposalError(
      'INVALID_INPUT',
      'Proposal writes are restricted to the configured Company Brain root.',
      { path },
    );
  }
  return path;
}

function normalizeRoot(root: string, label: string): string {
  const normalized = root.endsWith('/') ? root.slice(0, -1) : root;
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    hasControlCharacters(normalized)
  ) {
    throw new GitHubProposalError('INVALID_INPUT', `The configured ${label} is unsafe.`);
  }
  return normalized;
}

function requireSimpleName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100 || !/^[a-z\d_.-]+$/iu.test(trimmed)) {
    throw new GitHubProposalError('INVALID_INPUT', `The configured ${label} is invalid.`);
  }
  return trimmed;
}

function requireSafeRef(value: string, label: string): string {
  const trimmed = value.trim().replace(/\/+$/u, '');
  if (
    !trimmed ||
    trimmed.length > 200 ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.') ||
    trimmed.endsWith('.lock') ||
    trimmed.includes('..') ||
    trimmed.includes('@{') ||
    trimmed.includes('//') ||
    /\s/u.test(trimmed) ||
    ['~', '^', ':', '?', '*', '[', '\\'].some((character) => trimmed.includes(character)) ||
    hasControlCharacters(trimmed)
  ) {
    throw new GitHubProposalError('INVALID_INPUT', `The configured ${label} is invalid.`);
  }
  return trimmed;
}

function isWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isWithinAnyRoot(path: unknown, roots: readonly string[]): path is string {
  return typeof path === 'string' && roots.some((root) => isWithinRoot(path, root));
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function isProposalValidationResult(value: unknown): value is ProposalValidationResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ProposalValidationResult>;
  return (
    typeof candidate.valid === 'boolean' &&
    Array.isArray(candidate.errors) &&
    Array.isArray(candidate.warnings)
  );
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function slugify(value: string, maxLength: number): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, maxLength)
    .replace(/-+$/u, '');
}

function conflictsFromValidation(errors: readonly ValidationIssue[]): readonly ProposalConflict[] {
  const conflicts: ProposalConflict[] = [];
  for (const issue of errors) {
    const code = issue.code.toUpperCase();
    if (['DUPLICATE_ID', 'DUPLICATE_CONCEPT', 'DUPLICATE_CONCEPT_ID'].includes(code)) {
      conflicts.push({
        kind: 'duplicate_concept_id',
        message: 'The candidate introduces a duplicate concept identifier.',
        ...(issue.path ? { path: issue.path } : {}),
      });
    } else if (
      [
        'INCOMPATIBLE_ACTIVE_RECORD',
        'CONFLICTING_ACTIVE_RECORD',
        'CONTRADICTORY_ACTIVE_RECORDS',
        'OVERLAPPING_ACTIVE_RECORD',
      ].includes(code)
    ) {
      conflicts.push({
        kind: 'incompatible_active_record',
        message: 'The candidate introduces incompatible active knowledge records.',
        ...(issue.path ? { path: issue.path } : {}),
      });
    }
  }
  return deduplicateConflicts(conflicts);
}

function deduplicateConflicts(conflicts: readonly ProposalConflict[]): readonly ProposalConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.kind}\0${conflict.path ?? ''}\0${String(conflict.pullRequestNumber ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCommitMessage(title: string, proposalId: string, login: string): string {
  const subject = `brain: ${title.replace(/[\r\n]+/gu, ' ').slice(0, 64)}`;
  return `${subject}\n\nProposal-ID: ${proposalId}\nInitiated-by: @${login}`;
}

function buildPullRequestBody(input: {
  readonly proposalId: string;
  readonly request: CreateProposalRequest;
  readonly validation: ProposalValidationResult;
  readonly brainRoot: string;
}): string {
  const { proposalId, request, validation, brainRoot } = input;
  const rationale = request.rationale
    .split(/\r?\n/u)
    .map((line) => `> ${line || ' '}`)
    .join('\n');
  const changes = request.changes
    .map((change) => {
      const conceptId = change.path.slice(`${brainRoot}/`.length).replace(/\.md$/iu, '');
      return `| ${change.operation} | ${markdownCode(change.path)} | ${markdownCode(conceptId)} |`;
    })
    .join('\n');
  const validationSummary = validation.summary
    ? `\n\nValidator summary: ${validation.summary.replace(/[\r\n]+/gu, ' ').slice(0, 500)}`
    : '';

  return [
    `<!-- company-brain-proposal-id: ${proposalId} -->`,
    '## Company Brain proposal',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Proposal ID | ${markdownCode(proposalId)} |`,
    `| Authenticated actor | @${request.actor.githubLogin} (GitHub user ${String(request.actor.githubUserId)}) |`,
    `| Base SHA | ${markdownCode(request.baseSha)} |`,
    `| Validation | passed; ${String(validation.errors.length)} error(s), ${String(validation.warnings.length)} warning(s) |`,
    '',
    '### Rationale',
    '',
    rationale,
    '',
    '### Changed concepts and paths',
    '',
    '| Operation | Repository path | Concept ID |',
    '| --- | --- | --- |',
    changes,
    validationSummary,
    '',
    'This draft pull request was created by the Company Brain MCP server. It was not merged automatically.',
  ].join('\n');
}

function markdownCode(value: string): string {
  return `<code>${value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')}</code>`;
}

function summarizeMergeability(
  mergeable: boolean | null,
  mergeableState: string | undefined,
): Mergeability {
  if (mergeable === false || mergeableState === 'dirty') return 'conflicting';
  if (mergeable === true) return 'mergeable';
  return 'unknown';
}

function summarizeChecks(
  checkRuns: readonly { status: string; conclusion: string | null }[],
): ChecksStatus {
  if (checkRuns.length === 0) return 'neutral';
  if (checkRuns.some(({ status }) => status !== 'completed')) return 'pending';
  const failureConclusions = new Set([
    'action_required',
    'cancelled',
    'failure',
    'stale',
    'startup_failure',
    'timed_out',
  ]);
  if (
    checkRuns.some(({ conclusion }) => conclusion !== null && failureConclusions.has(conclusion))
  ) {
    return 'failure';
  }
  if (checkRuns.every(({ conclusion }) => conclusion === 'neutral' || conclusion === 'skipped')) {
    return 'neutral';
  }
  if (
    checkRuns.every(({ conclusion }) =>
      ['success', 'neutral', 'skipped'].includes(conclusion ?? ''),
    )
  ) {
    return 'success';
  }
  return 'unknown';
}

function summarizeCommitStatus(status: string): CommitStatus {
  return ['success', 'failure', 'error', 'pending'].includes(status)
    ? (status as CommitStatus)
    : 'unknown';
}

function proposalStatusFromRecord(
  record: ProposalRecord,
  dynamic: {
    readonly lifecycle?: ProposalStatusResult['lifecycle'];
    readonly mergeability: Mergeability;
    readonly githubMergeableState?: string;
    readonly checksStatus: ChecksStatus;
    readonly commitStatus: CommitStatus;
    readonly conflictState: ConflictState;
    readonly conflicts: readonly ProposalConflict[];
    readonly pullRequestUrl?: string;
  },
): ProposalStatusResult {
  return {
    proposalId: record.id,
    actor: record.actor,
    baseSha: record.baseSha,
    defaultBranch: record.defaultBranch,
    ...(record.branch ? { branch: record.branch } : {}),
    ...(record.commitSha ? { commitSha: record.commitSha } : {}),
    changedPaths: record.changes.map(({ path }) => path),
    ...(record.validation ? { validation: record.validation } : {}),
    ...(record.pullRequestNumber !== undefined
      ? { pullRequestNumber: record.pullRequestNumber }
      : {}),
    ...((dynamic.pullRequestUrl ?? record.pullRequestUrl)
      ? { pullRequestUrl: dynamic.pullRequestUrl ?? record.pullRequestUrl }
      : {}),
    lifecycle: dynamic.lifecycle ?? record.status,
    mergeability: dynamic.mergeability,
    ...(dynamic.githubMergeableState ? { githubMergeableState: dynamic.githubMergeableState } : {}),
    checksStatus: dynamic.checksStatus,
    commitStatus: dynamic.commitStatus,
    conflictState: dynamic.conflictState,
    conflicts: dynamic.conflicts,
    ...(record.failure ? { failure: record.failure } : {}),
  };
}
