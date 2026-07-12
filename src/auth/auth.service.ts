import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { UsersService } from '../users/services/users.service';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { RequestUser } from '../common/interfaces/request-user.interface';

@Injectable()
export class AuthService {
  private readonly refreshExpirationDays: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokensRepo: RefreshTokensRepository,
  ) {
    this.refreshExpirationDays = parseInt(
      this.config.getOrThrow<string>('REFRESH_TOKEN_EXPIRATION_DAYS'),
      10,
    );
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) throw new UnauthorizedException('auth.INVALID_CREDENTIALS');

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) throw new UnauthorizedException('auth.INVALID_CREDENTIALS');

    if (!user.is_active)
      throw new UnauthorizedException('auth.ACCOUNT_DEACTIVATED');

    if (user.shop_id !== null && user.shop_is_active === false)
      throw new UnauthorizedException('auth.SHOP_DEACTIVATED');

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shop_id,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.generateRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        shopId: user.shop_id,
      },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const tokenHash = this.hashToken(dto.refreshToken);
    const storedToken = await this.refreshTokensRepo.findValid(tokenHash);

    if (!storedToken) {
      // Reuse detection: if the token exists but is already revoked, it's a
      // replay of a rotated token — likely stolen. Revoke the whole family so
      // neither the attacker nor the victim can keep using it.
      const known = await this.refreshTokensRepo.findByHash(tokenHash);
      if (known && known.revoked_at !== null) {
        await this.refreshTokensRepo.revokeAllForUser(known.user_id);
      }
      throw new UnauthorizedException('auth.REFRESH_TOKEN_INVALID');
    }

    const user = await this.usersService.findByIdForAuth(storedToken.user_id);
    if (!user || !user.is_active)
      throw new UnauthorizedException('auth.ACCOUNT_DEACTIVATED');

    if (user.shop_id !== null && user.shop_is_active === false)
      throw new UnauthorizedException('auth.SHOP_DEACTIVATED');

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shop_id,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.rotateRefreshToken(storedToken.id, user.id);

    return { accessToken, refreshToken };
  }

  async logout(currentUser: RequestUser): Promise<void> {
    await this.refreshTokensRepo.revokeAllForUser(currentUser.id);
  }

  async changePassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findByIdForAuth(userId);
    if (!user || !user.is_active) {
      throw new UnauthorizedException('auth.ACCOUNT_DEACTIVATED');
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.password_hash);
    if (!valid) {
      throw new UnauthorizedException('auth.CURRENT_PASSWORD_INCORRECT');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.setPasswordHash(userId, passwordHash);

    // A password change signs the user out everywhere — revoke every refresh
    // token (this session's access token remains valid until it expires).
    await this.refreshTokensRepo.revokeAllForUser(userId);
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private async generateRefreshToken(userId: number): Promise<string> {
    const rawToken = randomUUID();
    const expiresAt = this.refreshExpiresAt();
    await this.refreshTokensRepo.create(userId, this.hashToken(rawToken), expiresAt);
    return rawToken;
  }

  private async rotateRefreshToken(oldId: bigint, userId: number): Promise<string> {
    const rawToken = randomUUID();
    const expiresAt = this.refreshExpiresAt();
    await this.refreshTokensRepo.rotate(oldId, userId, this.hashToken(rawToken), expiresAt);
    return rawToken;
  }

  private refreshExpiresAt(): Date {
    const d = new Date();
    d.setDate(d.getDate() + this.refreshExpirationDays);
    return d;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
