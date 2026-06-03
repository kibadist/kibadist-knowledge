import { IsUrl, MaxLength } from 'class-validator'

export class CreateUrlSourceDto {
  // Only http(s) URLs; the server fetches readable text from it (SSRF-guarded,
  // reusing the inbox url-fetch util).
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  url!: string
}
