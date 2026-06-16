import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from '../../common/interfaces/request-user.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest<{ user: RequestUser }>().user;
  },
);
