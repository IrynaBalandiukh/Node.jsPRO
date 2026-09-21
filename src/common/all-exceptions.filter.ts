import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { buildProblem } from './problem-json';

// express-openapi-validator errors (missing/invalid params, headers, body) are
// caught by the raw Express error middleware in main.ts, since they occur in
// middleware that runs before Nest's own routing/DI pipeline. This filter
// catches everything thrown from within controllers/services instead.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = this.resolveStatus(exception);
    const detail = this.resolveDetail(exception);

    response
      .status(status)
      .type('application/problem+json')
      .json(buildProblem(status, detail, request.originalUrl));
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    if (exception && typeof exception === 'object' && typeof (exception as any).status === 'number') {
      return (exception as { status: number }).status;
    }
    return 500;
  }

  private resolveDetail(exception: unknown): string {
    if (exception instanceof Error) {
      return exception.message;
    }
    return 'Unexpected error';
  }
}
