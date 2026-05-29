import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common'

import { AuthService } from './auth.service'
import type { AuthResponse, AuthUser } from './auth.types'
import { CurrentUser } from './current-user.decorator'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { LocalAuthGuard } from './guards/local-auth.guard'
import { Public } from './public.decorator'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto)
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(
    @CurrentUser() user: AuthUser,
    // Declared so the body is validated/documented; LocalStrategy reads it.
    @Body() _dto: LoginDto,
  ): Promise<AuthResponse> {
    return this.authService.login(user)
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user.userId)
  }
}
