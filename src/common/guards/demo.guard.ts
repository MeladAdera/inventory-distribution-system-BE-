import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DEMO_SEEDED_SHOP_MAX_ID, DEMO_SEEDED_USER_MAX_ID } from '../../database/seeders/demo-seed';

const BLOCKED_MESSAGE = 'This action is disabled in the demo';

// The demo's logins are shared and public. Without this, one visitor changing a
// password or deactivating a seeded account would lock out everyone after them.
const ALWAYS_BLOCKED = new Set([
  'POST /auth/change-password',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  // Uploads are saved to disk with no size limit: open file hosting on a public URL.
  'PATCH /products/:id/image',
  'PATCH /categories/:id/image',
]);

const SEEDED_ROW_LIMIT: Record<string, number> = {
  'PATCH /users/:id': DEMO_SEEDED_USER_MAX_ID,
  'DELETE /users/:id': DEMO_SEEDED_USER_MAX_ID,
  'PATCH /shops/:id/status': DEMO_SEEDED_SHOP_MAX_ID,
};

@Injectable()
export class DemoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (process.env.DEMO_MODE !== 'true') return true;

    const request = context.switchToHttp().getRequest<Request>();

    // Matched against the route pattern, not the URL: Express also accepts
    // /AUTH/change-password/ and a string comparison on the URL would miss it.
    const route = `${request.method} ${(request.route as { path: string }).path}`;

    if (ALWAYS_BLOCKED.has(route)) {
      throw new ForbiddenException(BLOCKED_MESSAGE);
    }

    const limit = SEEDED_ROW_LIMIT[route];
    if (limit !== undefined && Number(request.params.id) <= limit) {
      throw new ForbiddenException(BLOCKED_MESSAGE);
    }

    return true;
  }
}
