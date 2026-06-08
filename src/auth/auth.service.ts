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

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    if (!user.is_active)
      throw new UnauthorizedException('Your account has been deactivated');

    if (user.shop_id !== null && user.shop_is_active === false)
      throw new UnauthorizedException('Your shop has been deactivated');

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

    if (!storedToken) throw new UnauthorizedException('Invalid or expired refresh token');

    const user = await this.usersService.findByIdForAuth(storedToken.user_id);
    if (!user || !user.is_active)
      throw new UnauthorizedException('User no longer active');

    if (user.shop_id !== null && user.shop_is_active === false)
      throw new UnauthorizedException('Your shop has been deactivated');

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
