export type ProposalOperation = 'create' | 'update' | 'delete';

export interface ProposalActor {
  readonly githubUserId: number;
  readonly githubLogin: string;
}

export interface ProposalChange {
  readonly operation: ProposalOperation;
  /** Repository-relative path. Writes are restricted to the configured brain root. */
  readonly path: string;
  /** Exact new content. Required for create and update, forbidden for delete. */
  readonly content?: string;
  /** Lower-case or upper-case hexadecimal SHA-256 of the exact previous content. */
  readonly expectedContentSha256?: string;
  /** Git blob SHA reported by GitHub for the previous file. */
  readonly expectedBlobSha?: string;
}

export interface CreateProposalRequest {
  readonly baseSha: string;
  readonly title: string;
  readonly rationale: string;
  readonly actor: ProposalActor;
  readonly changes: readonly ProposalChange[];
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity?: 'error' | 'warning';
}

export interface ProposalValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly summary?: string;
}

export interface CandidateValidationContext {
  readonly proposalId: string;
  readonly owner: string;
  readonly repository: string;
  readonly brainRoot: string;
  readonly baseSha: string;
  readonly actor: ProposalActor;
  readonly changes: readonly ProposalChange[];
  readonly baseFiles: ReadonlyMap<string, string>;
}

export type CandidateValidator = (
  candidateFiles: ReadonlyMap<string, string>,
  context: CandidateValidationContext,
) => ProposalValidationResult | Promise<ProposalValidationResult>;

export interface OpenBrainProposal {
  readonly number: number;
  readonly url?: string;
  readonly branch: string;
  readonly changedPaths: readonly string[];
}

export interface ProposalConflict {
  readonly kind:
    | 'overlapping_path'
    | 'duplicate_concept_id'
    | 'incompatible_active_record'
    | 'github_merge_conflict'
    | 'semantic';
  readonly message: string;
  readonly path?: string;
  readonly pullRequestNumber?: number;
}

export interface SemanticConflictContext extends CandidateValidationContext {
  readonly candidateFiles: ReadonlyMap<string, string>;
  readonly openProposals: readonly OpenBrainProposal[];
}

export type SemanticConflictDetector = (
  context: SemanticConflictContext,
) => readonly ProposalConflict[] | Promise<readonly ProposalConflict[]>;

export type ProposalLifecycleStatus =
  | 'preparing'
  | 'validating'
  | 'stale'
  | 'rejected'
  | 'conflict'
  | 'writing'
  | 'commit_created'
  | 'branch_created'
  | 'pr_opened'
  | 'failed';

export interface ProposalFailure {
  readonly code: string;
  readonly message: string;
}

export interface StoredProposalChange {
  readonly operation: ProposalOperation;
  readonly path: string;
}

export interface ProposalRecord {
  readonly id: string;
  readonly actor: ProposalActor;
  readonly owner: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly baseSha: string;
  readonly title: string;
  readonly rationale: string;
  readonly changes: readonly StoredProposalChange[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ProposalLifecycleStatus;
  readonly branch?: string;
  readonly commitSha?: string;
  readonly pullRequestNumber?: number;
  readonly pullRequestUrl?: string;
  readonly validation?: ProposalValidationResult;
  readonly conflicts?: readonly ProposalConflict[];
  readonly failure?: ProposalFailure;
}

export interface ProposalStore {
  create(record: ProposalRecord): Promise<void>;
  update(id: string, patch: Partial<ProposalRecord>): Promise<void>;
  getById(id: string): Promise<ProposalRecord | undefined>;
  getByPullRequestNumber(number: number): Promise<ProposalRecord | undefined>;
}

export interface CreateProposalResult {
  readonly proposalId: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly validation: ProposalValidationResult;
}

export type Mergeability = 'mergeable' | 'conflicting' | 'unknown';
export type ChecksStatus = 'success' | 'failure' | 'pending' | 'neutral' | 'unknown';
export type CommitStatus = 'success' | 'failure' | 'error' | 'pending' | 'unknown';
export type ConflictState = 'clean' | 'conflict' | 'unknown';

export interface ProposalStatusResult {
  readonly proposalId: string;
  readonly actor: ProposalActor;
  readonly baseSha: string;
  readonly defaultBranch: string;
  readonly branch?: string;
  readonly commitSha?: string;
  readonly changedPaths: readonly string[];
  readonly validation?: ProposalValidationResult;
  readonly pullRequestNumber?: number;
  readonly pullRequestUrl?: string;
  readonly lifecycle: ProposalLifecycleStatus | 'open' | 'closed' | 'merged';
  readonly mergeability: Mergeability;
  readonly githubMergeableState?: string;
  readonly checksStatus: ChecksStatus;
  readonly commitStatus: CommitStatus;
  readonly conflictState: ConflictState;
  readonly conflicts: readonly ProposalConflict[];
  readonly failure?: ProposalFailure;
}

export interface GetProposalInput {
  readonly proposalId?: string;
  readonly pullRequestNumber?: number;
}

/**
 * The deliberately small portion of Octokit used by the proposal service.
 * A real authenticated Octokit instance is structurally compatible, and tests can
 * provide a tiny mock without emulating Octokit's request machinery.
 */
export interface GitHubClient {
  readonly git: {
    getRef(params: {
      owner: string;
      repo: string;
      ref: string;
    }): Promise<{ data: { object: { sha: string } } }>;
    getCommit(params: {
      owner: string;
      repo: string;
      commit_sha: string;
    }): Promise<{ data: { sha: string; tree: { sha: string } } }>;
    getTree(params: { owner: string; repo: string; tree_sha: string; recursive: 'true' }): Promise<{
      data: {
        truncated?: boolean;
        tree: {
          path?: string;
          mode?: string;
          type?: string;
          sha?: string;
        }[];
      };
    }>;
    getBlob(params: {
      owner: string;
      repo: string;
      file_sha: string;
    }): Promise<{ data: { content: string; encoding: string } }>;
    createBlob(params: {
      owner: string;
      repo: string;
      content: string;
      encoding: 'utf-8';
    }): Promise<{ data: { sha: string } }>;
    createTree(params: {
      owner: string;
      repo: string;
      base_tree: string;
      tree: {
        path: string;
        mode: '100644';
        type: 'blob';
        sha: string | null;
      }[];
    }): Promise<{ data: { sha: string } }>;
    createCommit(params: {
      owner: string;
      repo: string;
      message: string;
      tree: string;
      parents: string[];
    }): Promise<{ data: { sha: string } }>;
    createRef(params: {
      owner: string;
      repo: string;
      ref: string;
      sha: string;
    }): Promise<{ data: unknown }>;
  };
  readonly pulls: {
    list(params: {
      owner: string;
      repo: string;
      state: 'open';
      base: string;
      per_page: number;
      page: number;
    }): Promise<{
      data: {
        number: number;
        html_url?: string;
        head: { ref: string; sha?: string };
      }[];
    }>;
    listFiles(params: {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
      page: number;
    }): Promise<{ data: { filename: string }[] }>;
    create(params: {
      owner: string;
      repo: string;
      title: string;
      head: string;
      base: string;
      body: string;
      draft: true;
    }): Promise<{
      data: { number: number; html_url: string };
    }>;
    get(params: { owner: string; repo: string; pull_number: number }): Promise<{
      data: {
        number: number;
        html_url: string;
        state: 'open' | 'closed';
        merged?: boolean;
        draft?: boolean;
        mergeable: boolean | null;
        mergeable_state?: string;
        head: { sha: string; ref: string };
      };
    }>;
  };
  readonly checks: {
    listForRef(params: { owner: string; repo: string; ref: string; per_page: number }): Promise<{
      data: {
        check_runs: {
          status: string;
          conclusion: string | null;
        }[];
      };
    }>;
  };
  readonly repos: {
    getCombinedStatusForRef(params: {
      owner: string;
      repo: string;
      ref: string;
    }): Promise<{ data: { state: string } }>;
  };
}

export interface ProposalServiceConfig {
  readonly owner: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly brainRoot: string;
  /** Other read-only roots needed by the full validator, for example `knowledge`. */
  readonly validationRoots?: readonly string[];
  readonly branchPrefix?: string;
  readonly maxOpenProposalPages?: number;
}

export interface ProposalServiceDependencies {
  /** Must be an Octokit authenticated as the verified initiating GitHub user. */
  readonly github: GitHubClient;
  readonly store: ProposalStore;
  readonly validateCandidate: CandidateValidator;
  readonly detectSemanticConflicts?: SemanticConflictDetector;
  readonly now?: () => Date;
  readonly createProposalId?: () => string;
  readonly createBranchNonce?: () => string;
}
