import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { I18nService, I18nContext, I18nValidationException, I18nValidationError } from 'nestjs-i18n';

@Injectable()
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly i18n: I18nService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const req = ctx.getRequest<{ i18nLang?: string }>();
    const lang = I18nContext.current()?.lang ?? req.i18nLang ?? 'en';

    // I18nValidationException stores per-field messages on `.errors`, not on
    // getResponse()/message (those are just the generic "Bad Request"), so it
    // needs its own path instead of the generic exceptionResponse handling below.
    if (exception instanceof I18nValidationException) {
      const fieldMessages = this.flattenValidationErrors(exception.errors ?? [], lang);
      response.status(status).json({
        success: false,
        statusCode: status,
        message: fieldMessages.join('; ') || exception.message,
        error: 'Bad Request',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const exceptionResponse = exception.getResponse();

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

  // class-validator nests per-field errors under `children` for object/array
  // properties, so this walks the whole tree to collect every leaf message.
  private flattenValidationErrors(errors: I18nValidationError[], lang: string): string[] {
    return errors.flatMap((error) => [
      ...Object.values(error.constraints ?? {}).map((message) =>
        this.localizePropertyName(message, error.property, lang),
      ),
      ...this.flattenValidationErrors((error.children as I18nValidationError[]) ?? [], lang),
    ]);
  }

  // The constraint message already has the raw DTO field name (e.g. "quantity")
  // baked in via {property} at pipe-time, before this filter ever sees it — so
  // localizing it means translating the name separately and substituting it in.
  private localizePropertyName(message: string, property: string, lang: string): string {
    const label = this.i18n.translate(`fields.${property}`, { lang, defaultValue: property });
    if (label === property) return message;
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return message.replace(new RegExp(`\\b${escaped}\\b`), label);
  }
}
