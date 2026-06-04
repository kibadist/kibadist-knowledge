import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator'

export const WAITLIST_SOURCES = ['landing-hero', 'landing-footer'] as const

export class JoinWaitlistDto {
  @IsEmail()
  @MaxLength(254) // RFC 5321 max email length
  email!: string

  @IsOptional()
  @IsIn(WAITLIST_SOURCES)
  source?: string
}
