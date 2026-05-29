import { GateMode } from '@kibadist/prisma'
import { IsEnum } from 'class-validator'

export class SetModeDto {
  // QUICK (routine) or DEEP (new core-domain concept; stricter gates).
  @IsEnum(GateMode)
  mode!: GateMode
}
