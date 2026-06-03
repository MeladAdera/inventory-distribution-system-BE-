import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse() as any;

    const errorResponse = {
      success: false,
      statusCode: status,
      message: exceptionResponse?.message || exception.message,
      error: exceptionResponse?.error || 'Error',
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(errorResponse);
  }
}
