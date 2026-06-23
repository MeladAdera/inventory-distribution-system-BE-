import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { I18nService, I18nContext } from 'nestjs-i18n';

@Injectable()
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly i18n: I18nService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const req = ctx.getRequest<{ i18nLang?: string }>();
    const lang = I18nContext.current()?.lang ?? req.i18nLang ?? 'en';

    let rawKey: string;
    let args: Record<string, unknown> = {};
    let error = 'Error';

    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'key' in exceptionResponse
    ) {
      // Object form: thrown as new BadRequestException({ key: 'ns.KEY', args: {...} })
      const obj = exceptionResponse as { key: string; args?: Record<string, unknown>; error?: string };
      rawKey = obj.key;
      args = obj.args ?? {};
      error = obj.error ?? 'Error';
    } else {
      // String form: thrown as new NotFoundException('ns.KEY')
      const rawMessage =
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
          ? (exceptionResponse as { message: unknown }).message
          : exception.message;

      rawKey = Array.isArray(rawMessage)
        ? (rawMessage as string[]).join('; ')
        : (rawMessage as string);

      error =
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'error' in exceptionResponse
          ? (exceptionResponse as { error: string }).error
          : 'Error';
    }

    const message = this.resolveMessage(rawKey, args, lang);

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  // Translates if the string matches namespace.KEY pattern, otherwise returns as-is.
  private resolveMessage(
    key: string,
    args: Record<string, unknown>,
    lang: string,
  ): string {
    if (/^\w+\.[A-Z_]+$/.test(key)) {
      return this.i18n.translate(key, { lang, args });
    }
    return key;
  }
}
