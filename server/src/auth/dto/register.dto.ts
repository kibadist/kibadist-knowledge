import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

export class RegisterDto {
  @IsEmail()
  email!: string

  // Cap at 72: bcrypt only hashes the first 72 bytes and silently ignores the
  // rest, so a longer password would give a false sense of strength.
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(72)
  password!: string

  @IsOptional()
  @IsString()
  name?: string
}
