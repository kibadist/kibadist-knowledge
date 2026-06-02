import {
  IsHexColor,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

// A Domain (DET-234) is a semantic region of a workspace. The owning workspace
// is resolved from the request (header/query), never the client body; only
// presentation fields and an optional parent are user-supplied here.
export class CreateDomainDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  // Optional parent for nesting; must be a domain in the same workspace (the
  // service validates ownership + same-workspace). Null/omitted = top-level.
  @IsOptional()
  @IsString()
  parentDomainId?: string

  @IsOptional()
  @IsHexColor()
  color?: string
}
