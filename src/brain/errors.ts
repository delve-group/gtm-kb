export type BrainKernelErrorCode =
  | 'BRAIN_NOT_READY'
  | 'BRAIN_ROOT_INVALID'
  | 'INVALID_REQUEST'
  | 'UNSAFE_PATH'
  | 'NOT_FOUND'
  | 'AMBIGUOUS_CONCEPT'
  | 'AMBIGUOUS_HEADING';

export class BrainKernelError extends Error {
  readonly code: BrainKernelErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: BrainKernelErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'BrainKernelError';
    this.code = code;
    this.details = details;
  }
}
