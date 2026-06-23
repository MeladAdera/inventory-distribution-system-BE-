import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { I18nService, I18nContext } from 'nestjs-i18n';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<import('express').Response>();
    const req = ctx.getRequest<{ i18nLang?: string }>();
    const lang = I18nContext.current()?.lang ?? req.i18nLang ?? 'en';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : this.i18n.translate('common.INTERNAL_SERVER_ERROR', { lang });

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error: HttpStatus[status] ?? 'Error',
      timestamp: new Date().toISOString(),
    });
  }
}
