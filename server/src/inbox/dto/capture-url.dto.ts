import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator'

export class CaptureUrlDto {
  // Only http(s) URLs; the server fetches readable text from it (SSRF-guarded).
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  url!: string

  // Track-first onboarding (DET-240): route this capture into a track.
  @IsOptional()
  @IsString()
  trackId?: string
}
