import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

// Body for tagging a concept into a domain (DET-234): POST /concepts/:id/domains.
// A manual tag is created USER + userValidated true (the user is asserting the
// membership). `confidence` is optional metadata, normally left null for a human
// tag — it exists mainly so an AI-suggested membership can carry its score.
export class TagConceptDomainDto {
  @IsString()
  domainId!: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number
}
