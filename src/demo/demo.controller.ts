import { Controller, Get, Headers, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { resetDemoData } from '../database/seeders/demo-seed';

/**
 * Daily reset, called by a Vercel Cron Job (see vercel.json). Demo branch only.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`. Anyone can find this URL,
 * so without the secret it would let a visitor wipe the demo on demand.
 */
@ApiExcludeController()
@Controller('demo')
export class DemoController {
  @Get('reset')
  async reset(@Headers('authorization') authorization?: string): Promise<{ reset: true }> {
    if (process.env.DEMO_MODE !== 'true') throw new NotFoundException();

    const secret = process.env.CRON_SECRET ?? '';
    if (secret.length < 16 || !sameText(authorization ?? '', `Bearer ${secret}`)) {
      throw new UnauthorizedException();
    }

    await resetDemoData();
    return { reset: true };
  }
}

/** Constant-time comparison, so response timing doesn't leak the secret. */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
