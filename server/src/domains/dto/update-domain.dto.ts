import {
  IsHexColor,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

// Partial update of a Domain's presentation/nesting (DET-234). Every field is
// optional; `parentDomainId: null` un-nests a domain to top-level. Re-parenting
// is validated (same workspace, no self-parent) by the service.
export class UpdateDomainDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsOptional()
  @IsString()
  parentDomainId?: string | null

  @IsOptional()
  @IsHexColor()
  color?: string
}
