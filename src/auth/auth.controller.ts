import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Throttle({ global: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiOkResponse({
    description: 'Returns access token, refresh token, and user info',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or inactive account' })
  async login(@Body() dto: LoginDto) {
    this.logger.log('LOGIN REQUEST RECEIVED');
    this.logger.log(`Email: ${dto.email}`);
    try {
      const result = await this.authService.login(dto);
      this.logger.log(`Login success for: ${dto.email}`);
      return result;
    } catch (error) {
      this.logger.warn(`Login failed for: ${dto.email} — ${(error as Error).message}`);
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get a new access token' })
  @ApiOkResponse({ description: 'Returns new access token and rotated refresh token' })
  @ApiUnauthorizedResponse({ description: 'Refresh token is invalid, expired, or revoked' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current user' })
  logout(@CurrentUser() user: RequestUser) {
    return this.authService.logout(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@CurrentUser() user: RequestUser) {
    return user;
  }
}
