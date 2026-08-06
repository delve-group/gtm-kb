export type GitHubProposalErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'STALE_BASE'
  | 'GIT_CONFLICT'
  | 'GITHUB_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const HTTP_STATUS: Record<GitHubProposalErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  STALE_BASE: 409,
  GIT_CONFLICT: 409,
  GITHUB_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class GitHubProposalError extends Error {
  readonly code: GitHubProposalErrorCode;
  readonly httpStatus: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: GitHubProposalErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(message);
    this.name = 'GitHubProposalError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause,
      });
    }
  }
}

export function isGitHubProposalError(error: unknown): error is GitHubProposalError {
  return error instanceof GitHubProposalError;
}

export function githubHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
