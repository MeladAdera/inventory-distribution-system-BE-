import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../../common/enums/user-role.enum';
import { UsersService } from '../../users/services/users.service';

interface JwtPayload {
  sub: number;
  email: string;
  role: UserRole;
  shopId: number | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Called on every authenticated request. Re-fetches the user so that
  // deactivations and shop suspensions take effect within the current
  // access-token window (15 min) instead of waiting for expiry.
  async validate(payload: JwtPayload) {
    const user = await this.usersService.findByIdForAuth(payload.sub);

    if (!user || !user.is_active) {
      throw new UnauthorizedException('auth.ACCOUNT_DEACTIVATED');
    }

    if (user.shop_id !== null && user.shop_is_active === false) {
      throw new UnauthorizedException('auth.SHOP_DEACTIVATED');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shop_id,
    };
  }
}
