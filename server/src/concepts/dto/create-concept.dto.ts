import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

// NOTE: there is intentionally no `status` field. A concept can only be created
// as an INBOX capture; reaching ARTICULATED/PERMANENT happens exclusively through
// the Proof-of-Learning Gate (DET-189). Accepting a client-supplied status here
// would be a "skip the gate" backdoor, which the DoD forbids.
export class CreateConceptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string
}
