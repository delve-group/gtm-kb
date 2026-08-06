import { randomUUID } from 'node:crypto';
import { AuthError } from './auth/errors.js';
import { BrainKernelError } from './brain/errors.js';
import { GitHubProposalError } from './github/errors.js';

export const errorCategories = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_INPUT',
  'RATE_LIMITED',
  'NOT_FOUND',
  'AMBIGUOUS_CONCEPT',
  'VALIDATION_FAILED',
  'STALE_BASE',
  'GIT_CONFLICT',
  'GITHUB_UNAVAILABLE',
  'LANGFUSE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCategory = (typeof errorCategories)[number];

const statusByCategory: Record<ErrorCategory, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  AMBIGUOUS_CONCEPT: 409,
  VALIDATION_FAILED: 422,
  STALE_BASE: 409,
  GIT_CONFLICT: 409,
  GITHUB_UNAVAILABLE: 503,
  LANGFUSE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly correlationId: string;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    category: ErrorCategory,
    message: string,
    options: {
      cause?: unknown;
      correlationId?: string;
      details?: Readonly<Record<string, unknown>>;
      status?: number;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.category = category;
    this.correlationId = options.correlationId ?? randomUUID();
    this.status = options.status ?? statusByCategory[category];
    this.details = options.details;
  }
}

export interface SafeError {
  category: ErrorCategory;
  message: string;
  correlation_id: string;
  details?: Readonly<Record<string, unknown>>;
}

export function toAppError(error: unknown, correlationId?: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AuthError) {
    const category = error.code === 'AUTH_PROVIDER_UNAVAILABLE' ? 'GITHUB_UNAVAILABLE' : error.code;
    return new AppError(category, error.message, {
      cause: error,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }
  if (error instanceof BrainKernelError) {
    const category: ErrorCategory =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'AMBIGUOUS_CONCEPT' || error.code === 'AMBIGUOUS_HEADING'
          ? 'AMBIGUOUS_CONCEPT'
          : error.code === 'INVALID_REQUEST' || error.code === 'UNSAFE_PATH'
            ? 'INVALID_INPUT'
            : 'INTERNAL_ERROR';
    return new AppError(category, error.message, {
      cause: error,
      ...(category === 'INTERNAL_ERROR' ? {} : { details: error.details }),
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }
  if (error instanceof GitHubProposalError) {
    return new AppError(error.code, error.message, {
      cause: error,
      details: error.details,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
  }
  return new AppError('INTERNAL_ERROR', 'The operation could not be completed.', {
    cause: error,
    ...(correlationId === undefined ? {} : { correlationId }),
  });
}

export function serializeError(error: unknown, correlationId?: string): SafeError {
  const appError = toAppError(error, correlationId);
  return {
    category: appError.category,
    message: appError.message,
    correlation_id: appError.correlationId,
    ...(appError.details === undefined ? {} : { details: appError.details }),
  };
}
