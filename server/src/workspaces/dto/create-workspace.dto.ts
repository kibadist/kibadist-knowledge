import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

// A Workspace is the tenancy container (DET-232): the "world" a body of
// knowledge belongs to. Only presentation fields are user-supplied here —
// ownership is taken from the authenticated user, never the client.
export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string
}
