export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string | undefined;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.requestId = body.error.requestId;
    this.details = body.error.details;
  }
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
}
export interface ReadyResponse {
  status: 'ready';
  checks: { db: 'ok' | 'fail' };
}
