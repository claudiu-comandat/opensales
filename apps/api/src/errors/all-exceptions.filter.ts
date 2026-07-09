import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';

import { DomainError } from './domain.error.js';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId?: string | undefined;
    details?: unknown;
  };
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('AllExceptionsFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<{ id?: string; url?: string; method?: string }>();
    const res = ctx.getResponse<{ status: (n: number) => { json: (b: unknown) => void } }>();
    const requestId = req.id;

    const { status, body, logLevel } = this.toResponse(exception, requestId);

    if (logLevel === 'error') {
      this.logger.error(
        { err: exception, requestId, url: req.url, method: req.method },
        body.error.message,
      );
    } else {
      this.logger.warn(
        { requestId, url: req.url, method: req.method, code: body.error.code },
        body.error.message,
      );
    }

    res.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
    requestId?: string,
  ): { status: number; body: ErrorResponseBody; logLevel: 'warn' | 'error' } {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            requestId,
            details: exception.details,
          },
        },
        logLevel: exception.httpStatus >= 500 ? 'error' : 'warn',
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            requestId,
            details: exception.issues.map((i) => ({ path: i.path, message: i.message })),
          },
        },
        logLevel: 'warn',
      };
    }

    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      return {
        status: exception.getStatus(),
        body: {
          error: {
            code: this.codeFromStatus(exception.getStatus()),
            message:
              typeof resp === 'string'
                ? resp
                : ((resp as { message?: string }).message ?? exception.message),
            requestId,
          },
        },
        logLevel: exception.getStatus() >= 500 ? 'error' : 'warn',
      };
    }

    // FgoApiError (and similar plugin external-API errors) — duck-typed to avoid
    // importing plugin packages. Surfaces the actual provider error message as 502.
    if (
      exception instanceof Error &&
      exception.name === 'FgoApiError' &&
      'fgoMessage' in exception
    ) {
      const fgoErr = exception as unknown as { fgoMessage: string; status: number; path: string };
      return {
        status: HttpStatus.BAD_GATEWAY,
        body: {
          error: {
            code: 'EXTERNAL_API_ERROR',
            message: fgoErr.fgoMessage || exception.message,
            requestId,
            details: { fgoStatus: fgoErr.status, fgoPath: fgoErr.path },
          },
        },
        logLevel: 'error',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          requestId,
        },
      },
      logLevel: 'error',
    };
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'UNPROCESSABLE_ENTITY';
      case 503:
        return 'SERVICE_UNAVAILABLE';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'CLIENT_ERROR';
    }
  }
}
