import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

// Partial update of a workspace's presentation fields. Ownership and concepts
// are never re-parented here.
export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string
}
