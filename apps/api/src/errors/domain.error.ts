export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'STOCK_RESERVATION_FAILED'
  | 'PLUGIN_PERMISSION_DENIED'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: DomainErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  static notFound(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError('NOT_FOUND', message, 404, details);
  }

  static validation(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError('VALIDATION_FAILED', message, 400, details);
  }

  static conflict(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError('CONFLICT', message, 409, details);
  }

  static unauthorized(message = 'Unauthorized'): DomainError {
    return new DomainError('UNAUTHORIZED', message, 401);
  }

  static forbidden(message = 'Forbidden'): DomainError {
    return new DomainError('FORBIDDEN', message, 403);
  }
}
