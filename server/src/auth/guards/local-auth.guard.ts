import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

/** Runs the passport-local strategy to validate email + password on login. */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
