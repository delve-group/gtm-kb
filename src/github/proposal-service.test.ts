/* eslint-disable @typescript-eslint/require-await -- GitHub mocks implement promise-returning SDK methods. */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GitHubProposalError } from './errors.js';
import { GitHubProposalService } from './proposal-service.js';
import { InMemoryProposalStore } from './proposal-store.js';
import type {
  CreateProposalRequest,
  GitHubClient,
  ProposalConflict,
  ProposalValidationResult,
} from './types.js';

const BASE_SHA = '1'.repeat(40);
const OTHER_SHA = '2'.repeat(40);
const TREE_SHA = '3'.repeat(40);
const INDEX_BLOB_SHA = '4'.repeat(40);
const SOURCE_BLOB_SHA = '5'.repeat(40);
const COMMIT_SHA = '6'.repeat(40);

const VALID: ProposalValidationResult = {
  valid: true,
  errors: [],
  warnings: [],
  summary: 'All Company Brain checks passed.',
};

interface MockOptions {
  headSha?: string;
  headShas?: readonly string[];
  openPullRequests?: {
    number: number;
    html_url: string;
    head: { ref: string; sha: string };
  }[];
  pullRequestFiles?: Readonly<Record<number, readonly string[]>>;
  mergeable?: boolean | null;
  mergeableState?: string;
  createPullRequestStatus?: number;
}

function createGitHubMock(options: MockOptions = {}): {
  client: GitHubClient;
  calls: { name: string; params: unknown }[];
  setMergeability: (mergeable: boolean | null, state?: string) => void;
  mergeCalls: () => number;
} {
  const calls: { name: string; params: unknown }[] = [];
  let blobNumber = 0;
  let mergeable: boolean | null = options.mergeable === undefined ? true : options.mergeable;
  let mergeableState = options.mergeableState ?? 'clean';
  let forbiddenMergeCalls = 0;
  let headRead = 0;
  const record = (name: string, params: unknown): void => {
    calls.push({ name, params });
  };

  const pulls: GitHubClient['pulls'] & { merge: () => Promise<never> } = {
    list: async (params) => {
      record('pulls.list', params);
      return { data: options.openPullRequests ?? [] };
    },
    listFiles: async (params) => {
      record('pulls.listFiles', params);
      return {
        data: (options.pullRequestFiles?.[params.pull_number] ?? []).map((filename) => ({
          filename,
        })),
      };
    },
    create: async (params) => {
      record('pulls.create', params);
      if (options.createPullRequestStatus !== undefined) {
        throw Object.assign(new Error('GitHub rejected the pull request'), {
          status: options.createPullRequestStatus,
        });
      }
      return { data: { number: 42, html_url: 'https://github.test/acme/brain/pull/42' } };
    },
    get: async (params) => {
      record('pulls.get', params);
      return {
        data: {
          number: params.pull_number,
          html_url: `https://github.test/acme/brain/pull/${String(params.pull_number)}`,
          state: 'open' as const,
          merged: false,
          draft: true,
          mergeable,
          mergeable_state: mergeableState,
          head: { sha: COMMIT_SHA, ref: 'brain/alice/proposal' },
        },
      };
    },
    merge: async () => {
      forbiddenMergeCalls += 1;
      throw new Error('The proposal service must never merge');
    },
  };

  const client: GitHubClient = {
    git: {
      getRef: async (params) => {
        record('git.getRef', params);
        const sequence = options.headShas;
        const sha = sequence
          ? (sequence[Math.min(headRead, sequence.length - 1)] ?? BASE_SHA)
          : (options.headSha ?? BASE_SHA);
        headRead += 1;
        return { data: { object: { sha } } };
      },
      getCommit: async (params) => {
        record('git.getCommit', params);
        return { data: { sha: BASE_SHA, tree: { sha: TREE_SHA } } };
      },
      getTree: async (params) => {
        record('git.getTree', params);
        return {
          data: {
            truncated: false,
            tree: [
              { path: 'brain/index.md', type: 'blob', mode: '100644', sha: INDEX_BLOB_SHA },
              {
                path: 'knowledge/reference.md',
                type: 'blob',
                mode: '100644',
                sha: SOURCE_BLOB_SHA,
              },
            ],
          },
        };
      },
      getBlob: async (params) => {
        record('git.getBlob', params);
        const content = params.file_sha === INDEX_BLOB_SHA ? 'old brain' : 'legacy source';
        return { data: { content: Buffer.from(content).toString('base64'), encoding: 'base64' } };
      },
      createBlob: async (params) => {
        record('git.createBlob', params);
        blobNumber += 1;
        return { data: { sha: String(blobNumber).repeat(40) } };
      },
      createTree: async (params) => {
        record('git.createTree', params);
        return { data: { sha: '7'.repeat(40) } };
      },
      createCommit: async (params) => {
        record('git.createCommit', params);
        return { data: { sha: COMMIT_SHA } };
      },
      createRef: async (params) => {
        record('git.createRef', params);
        return { data: {} };
      },
    },
    pulls,
    checks: {
      listForRef: async (params) => {
        record('checks.listForRef', params);
        return {
          data: {
            check_runs: [{ status: 'completed', conclusion: 'success' }],
          },
        };
      },
    },
    repos: {
      getCombinedStatusForRef: async (params) => {
        record('repos.getCombinedStatusForRef', params);
        return { data: { state: 'success' } };
      },
    },
  };

  return {
    client,
    calls,
    setMergeability: (value, state = value === null ? 'unknown' : value ? 'clean' : 'dirty') => {
      mergeable = value;
      mergeableState = state;
    },
    mergeCalls: () => forbiddenMergeCalls,
  };
}

function request(overrides: Partial<CreateProposalRequest> = {}): CreateProposalRequest {
  return {
    baseSha: BASE_SHA,
    title: 'Refresh product positioning',
    rationale: 'Keep approved product knowledge current.',
    actor: { githubUserId: 101, githubLogin: 'alice' },
    changes: [
      {
        operation: 'update',
        path: 'brain/index.md',
        content: 'new brain',
        expectedContentSha256: createHash('sha256').update('old brain').digest('hex'),
        expectedBlobSha: INDEX_BLOB_SHA,
      },
    ],
    ...overrides,
  };
}

function service(
  mock: ReturnType<typeof createGitHubMock>,
  options: {
    validation?: ProposalValidationResult;
    store?: InMemoryProposalStore;
    semanticConflicts?: readonly ProposalConflict[];
  } = {},
): { service: GitHubProposalService; store: InMemoryProposalStore } {
  const store = options.store ?? new InMemoryProposalStore();
  let proposalNumber = 0;
  let nonceNumber = 0;
  return {
    store,
    service: new GitHubProposalService(
      {
        owner: 'acme',
        repository: 'company-brain',
        defaultBranch: 'main',
        brainRoot: 'brain',
        validationRoots: ['knowledge'],
      },
      {
        github: mock.client,
        store,
        validateCandidate: async (files) => {
          if ((options.validation ?? VALID).valid) {
            expect(files.get('knowledge/reference.md')).toBe('legacy source');
          }
          return options.validation ?? VALID;
        },
        ...(options.semanticConflicts
          ? { detectSemanticConflicts: async () => options.semanticConflicts ?? [] }
          : {}),
        now: () => new Date('2026-08-06T12:34:56.000Z'),
        createProposalId: () => `proposal-${String(++proposalNumber)}`,
        createBranchNonce: () => `nonce-${String(++nonceNumber)}`,
      },
    ),
  };
}

function writeCalls(calls: readonly { name: string }[]): readonly string[] {
  const writes = new Set([
    'git.createBlob',
    'git.createTree',
    'git.createCommit',
    'git.createRef',
    'pulls.create',
  ]);
  return calls.map(({ name }) => name).filter((name) => writes.has(name));
}

describe('GitHubProposalService', () => {
  it('validates the full candidate before creating a non-force branch and draft PR', async () => {
    const mock = createGitHubMock();
    const harness = service(mock);

    const result = await harness.service.createProposal(request());

    expect(result.branch).toMatch(
      /^brain\/alice\/20260806123456-refresh-product-positioning-nonce-1$/u,
    );
    expect(result.commitSha).toBe(COMMIT_SHA);
    const secondHeadRead = mock.calls.map(({ name }) => name).lastIndexOf('git.getRef');
    const firstWrite = mock.calls.findIndex(({ name }) => name === 'git.createBlob');
    expect(secondHeadRead).toBeLessThan(firstWrite);

    const createTree = mock.calls.find(({ name }) => name === 'git.createTree')?.params as {
      base_tree: string;
    };
    expect(createTree.base_tree).toBe(TREE_SHA);
    const createCommit = mock.calls.find(({ name }) => name === 'git.createCommit')?.params as {
      parents: string[];
      author?: unknown;
      committer?: unknown;
    };
    expect(createCommit.parents).toEqual([BASE_SHA]);
    expect(createCommit).not.toHaveProperty('author');
    expect(createCommit).not.toHaveProperty('committer');

    const createRef = mock.calls.find(({ name }) => name === 'git.createRef')?.params as {
      ref: string;
      sha: string;
      force?: boolean;
    };
    expect(createRef).toEqual({
      owner: 'acme',
      repo: 'company-brain',
      ref: `refs/heads/${result.branch}`,
      sha: COMMIT_SHA,
    });
    expect(createRef.ref).not.toBe('refs/heads/main');
    expect(createRef).not.toHaveProperty('force');

    const createPullRequest = mock.calls.find(({ name }) => name === 'pulls.create')?.params as {
      draft: boolean;
      base: string;
      head: string;
      body: string;
    };
    expect(createPullRequest.draft).toBe(true);
    expect(createPullRequest.base).toBe('main');
    expect(createPullRequest.head).toBe(result.branch);
    expect(createPullRequest.body).toContain('proposal-1');
    expect(createPullRequest.body).toContain('@alice (GitHub user 101)');
    expect(createPullRequest.body).toContain(BASE_SHA);
    expect(createPullRequest.body).toContain('brain/index.md');
    expect(mock.mergeCalls()).toBe(0);
    expect((harness.service as unknown as { merge?: unknown }).merge).toBeUndefined();
  });

  it('does not perform any remote write when candidate validation fails', async () => {
    const mock = createGitHubMock();
    const invalid: ProposalValidationResult = {
      valid: false,
      errors: [{ code: 'BROKEN_LINK', message: 'Broken relation', path: 'brain/index.md' }],
      warnings: [],
    };
    const harness = service(mock, { validation: invalid });

    await expect(harness.service.createProposal(request())).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    expect(writeCalls(mock.calls)).toEqual([]);
    await expect(harness.store.getById('proposal-1')).resolves.toMatchObject({
      status: 'rejected',
      validation: invalid,
    });
  });

  it('rejects a stale default-branch SHA before reading or writing proposal content', async () => {
    const mock = createGitHubMock({ headSha: OTHER_SHA });
    const harness = service(mock);

    await expect(harness.service.createProposal(request())).rejects.toMatchObject({
      code: 'STALE_BASE',
    });

    expect(mock.calls.map(({ name }) => name)).toEqual(['git.getRef']);
    expect(writeCalls(mock.calls)).toEqual([]);
    await expect(harness.store.getById('proposal-1')).resolves.toMatchObject({ status: 'stale' });
  });

  it('closes the validation race with a second head check before any GitHub write', async () => {
    const mock = createGitHubMock({ headShas: [BASE_SHA, OTHER_SHA] });
    const harness = service(mock);

    await expect(harness.service.createProposal(request())).rejects.toMatchObject({
      code: 'STALE_BASE',
    });

    expect(mock.calls.filter(({ name }) => name === 'git.getRef')).toHaveLength(2);
    expect(writeCalls(mock.calls)).toEqual([]);
    await expect(harness.store.getById('proposal-1')).resolves.toMatchObject({ status: 'stale' });
  });

  it('uses a unique branch for concurrent proposals without updating another ref', async () => {
    const mock = createGitHubMock();
    const harness = service(mock);

    const first = await harness.service.createProposal(request());
    const second = await harness.service.createProposal(
      request({ title: 'Refresh product positioning' }),
    );

    expect(first.branch).not.toBe(second.branch);
    const refs = mock.calls
      .filter(({ name }) => name === 'git.createRef')
      .map(({ params }) => (params as { ref: string }).ref);
    expect(new Set(refs).size).toBe(2);
    expect(mock.calls.some(({ name }) => name === 'git.updateRef')).toBe(false);
  });

  it('reports overlapping open brain proposals as conflicts without remote writes', async () => {
    const mock = createGitHubMock({
      openPullRequests: [
        {
          number: 9,
          html_url: 'https://github.test/acme/brain/pull/9',
          head: { ref: 'brain/bob/existing', sha: OTHER_SHA },
        },
      ],
      pullRequestFiles: { 9: ['brain/index.md'] },
    });
    const harness = service(mock);

    await expect(harness.service.createProposal(request())).rejects.toMatchObject({
      code: 'GIT_CONFLICT',
      details: {
        conflicts: [
          expect.objectContaining({
            kind: 'overlapping_path',
            path: 'brain/index.md',
            pullRequestNumber: 9,
          }),
        ],
      },
    });

    expect(writeCalls(mock.calls)).toEqual([]);
    await expect(harness.store.getById('proposal-1')).resolves.toMatchObject({
      status: 'conflict',
      conflicts: [expect.objectContaining({ kind: 'overlapping_path', pullRequestNumber: 9 })],
    });
  });

  it('runs the semantic conflict hook and fails closed before remote writes', async () => {
    const mock = createGitHubMock();
    const harness = service(mock, {
      semanticConflicts: [
        {
          kind: 'incompatible_active_record',
          message: 'Two active records overlap.',
          path: 'brain/index.md',
        },
      ],
    });

    await expect(harness.service.createProposal(request())).rejects.toMatchObject({
      code: 'GIT_CONFLICT',
      details: {
        conflicts: [expect.objectContaining({ kind: 'incompatible_active_record' })],
      },
    });
    expect(writeCalls(mock.calls)).toEqual([]);
  });

  it('fails an expected-content mismatch before validation or remote writes', async () => {
    const mock = createGitHubMock();
    const harness = service(mock);

    await expect(
      harness.service.createProposal(
        request({
          changes: [
            {
              operation: 'update',
              path: 'brain/index.md',
              content: 'new brain',
              expectedContentSha256: 'a'.repeat(64),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'GIT_CONFLICT' });

    expect(writeCalls(mock.calls)).toEqual([]);
  });

  it('returns tri-state mergeability, checks, commit status, and conflict state', async () => {
    const mock = createGitHubMock({ mergeable: null, mergeableState: 'unknown' });
    const harness = service(mock);
    await harness.service.createProposal(request());

    const pending = await harness.service.getProposal({ proposalId: 'proposal-1' });
    expect(pending).toMatchObject({
      proposalId: 'proposal-1',
      pullRequestNumber: 42,
      mergeability: 'unknown',
      checksStatus: 'success',
      commitStatus: 'success',
      conflictState: 'unknown',
      lifecycle: 'open',
    });

    mock.setMergeability(false, 'dirty');
    const conflicting = await harness.service.getProposal({ pullRequestNumber: 42 });
    expect(conflicting.mergeability).toBe('conflicting');
    expect(conflicting.conflictState).toBe('conflict');
    expect(conflicting.conflicts).toEqual([
      expect.objectContaining({ kind: 'github_merge_conflict', pullRequestNumber: 42 }),
    ]);
  });

  it('persists the commit and branch when opening the draft PR partially fails', async () => {
    const mock = createGitHubMock({ createPullRequestStatus: 422 });
    const harness = service(mock);

    await expect(harness.service.createProposal(request())).rejects.toMatchObject({
      code: 'GIT_CONFLICT',
    });
    const stored = await harness.store.getById('proposal-1');
    expect(stored).toMatchObject({
      status: 'conflict',
      commitSha: COMMIT_SHA,
      failure: { code: 'GIT_CONFLICT' },
    });
    expect(stored?.branch).toMatch(/^brain\/alice\//u);
    expect(mock.calls.some(({ name }) => name === 'git.createRef')).toBe(true);
    expect(mock.calls.some(({ name }) => name === 'pulls.create')).toBe(true);
    expect(mock.mergeCalls()).toBe(0);
  });

  it('maps malformed and out-of-root writes to stable safe errors', async () => {
    const mock = createGitHubMock();
    const harness = service(mock);

    await expect(
      harness.service.createProposal(
        request({
          changes: [{ operation: 'create', path: '../secrets.txt', content: 'no' }],
        }),
      ),
    ).rejects.toBeInstanceOf(GitHubProposalError);
    await expect(
      harness.service.createProposal(
        request({
          changes: [{ operation: 'create', path: 'knowledge/new.md', content: 'no' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', httpStatus: 400 });
    expect(writeCalls(mock.calls)).toEqual([]);
  });
});
