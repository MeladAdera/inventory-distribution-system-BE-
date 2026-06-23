import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: RequestUser }>().user;

    // No user on the request means JwtAuthGuard didn't run or the token was
    // missing — this is unauthenticated (401), not unauthorized (403).
    if (!user) {
      throw new UnauthorizedException('common.UNAUTHORIZED');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException('common.FORBIDDEN');
    }

    return true;
  }
}
