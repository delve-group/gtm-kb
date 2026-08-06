export type AuthErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'AUTH_PROVIDER_UNAVAILABLE';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly statusCode: 401 | 403 | 503;

  constructor(
    code: AuthErrorCode,
    message: string,
    statusCode: 401 | 403 | 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class OAuthStateError extends AuthError {
  readonly reason: 'invalid' | 'expired' | 'consumed' | 'redirect_mismatch';

  constructor(reason: OAuthStateError['reason']) {
    super('UNAUTHENTICATED', 'The OAuth authorization attempt is invalid or expired.', 401);
    this.name = 'OAuthStateError';
    this.reason = reason;
  }
}
