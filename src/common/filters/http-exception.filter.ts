import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import type { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const rawMessage =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
        ? (exceptionResponse as { message: unknown }).message
        : exception.message;

    const message = Array.isArray(rawMessage) ? (rawMessage as string[]).join('; ') : (rawMessage as string);

    const error =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'error' in exceptionResponse
        ? (exceptionResponse as { error: string }).error
        : 'Error';

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
    });
  }
}
