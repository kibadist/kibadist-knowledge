import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { UsersModule } from '../users/users.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './jwt.strategy'
import { LocalStrategy } from './local.strategy'

@Module({
  imports: [
    UsersModule,
    WorkspacesModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET')
        if (!secret) {
          throw new Error('JWT_SECRET is not configured')
        }
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN') || '7d'
        // Fail fast at boot on a malformed duration instead of at first sign().
        if (!/^\d+(ms|s|m|h|d|w|y)?$/.test(expiresIn)) {
          throw new Error(
            `Invalid JWT_EXPIRES_IN: "${expiresIn}" (use e.g. "7d", "15m", "3600")`,
          )
        }
        return {
          secret,
          signOptions: {
            // Cast the env string to the exact type @nestjs/jwt accepts (the `ms`
            // StringValue union), validated above.
            expiresIn: expiresIn as NonNullable<
              JwtModuleOptions['signOptions']
            >['expiresIn'],
          },
        }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
